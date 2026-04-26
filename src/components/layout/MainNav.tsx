'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  PlusCircle,
  CreditCard,
  ClipboardList,
  TrendingUp,
  History,
  Receipt,
  Wallet,
  Lock,
  ArrowLeftRight,
  BarChart3,
  Clock,
  Calculator,
  Settings,
  Scissors,
  Tags,
  Shield,
  Activity,
  Users,
  ChevronDown,
  Menu,
  X,
  SlidersHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  disabled?: boolean;
  children?: NavItem[];
}

// Navigation with Categories/Sections
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
      { href: '/income/pos', label: 'نقطة البيع', icon: LayoutGrid },
      { href: '/income/new', label: 'إيراد جديد', icon: PlusCircle },
      { href: '/income/collection', label: 'تحصيل / دفعة', icon: CreditCard, disabled: true },
    ]
  },
  {
    title: 'مراجعة المدخلات',
    icon: ClipboardList,
    items: [
      { href: '/sales/today', label: 'مبيعات اليوم', icon: TrendingUp },
      { href: '/income-review/all-sales', label: 'كل المبيعات', icon: History },
      { href: '/income-review/today-revenue', label: 'إيرادات اليوم', icon: Wallet },
      { href: '/income-review/all-revenue', label: 'كل الإيرادات', icon: History },
      { href: '/income-review/payments', label: 'المدفوعات', icon: CreditCard },
    ]
  },
  {
    title: 'المصروفات',
    icon: Receipt,
    items: [
      { href: '/expenses', label: 'تسجيل مصروف', icon: Receipt },
      { href: '/expenses/salaries', label: 'مرتبات العاملين', icon: Users },
      { href: '/expenses/fixed', label: 'المصروفات الثابتة', icon: Wallet },
    ]
  },
  {
    title: 'مراجعة المصروفات',
    icon: BarChart3,
    items: [
      { href: '/reports/expenses/monthly', label: 'تقرير المصروفات', icon: BarChart3 },
      { href: '/expenses-review/salaries', label: 'تقرير المرتبات', icon: Wallet },
      { href: '/expenses-review/advances', label: 'السلف والخصومات', icon: CreditCard },
    ]
  },
  {
    title: 'الخزنة',
    icon: Wallet,
    items: [
      { href: '/treasury/daily', label: 'قفل اليوم', icon: Lock },
      { href: '/treasury/movement', label: 'حركة الخزنة', icon: ArrowLeftRight },
      { href: '/treasury/summary', label: 'ملخص حسب الدفع', icon: BarChart3 },
      { href: '/treasury/shift-close', label: 'تقفيل الوردية', icon: Clock },
    ]
  },
  {
    title: 'الميزانية',
    icon: Calculator,
    items: [
      { href: '/budget', label: 'الميزانية الشهرية', icon: Calculator },
    ]
  },
  {
    title: 'الإدارة',
    icon: Settings,
    items: [
      { href: '/admin/operations', label: 'مركز التشغيل', icon: Activity },
      { href: '/admin/employees', label: 'الموظفون', icon: Users },
      { href: '/admin/users', label: 'المستخدمون', icon: Shield },
      { href: '/admin/services', label: 'الخدمات', icon: Scissors },
      { href: '/admin/payment-methods', label: 'طرق الدفع', icon: CreditCard },
      { href: '/admin/categories', label: 'التصنيفات', icon: Tags },
      { href: '/admin/shift', label: 'الورديات', icon: Clock },
      { href: '/admin/settings', label: 'الإعدادات', icon: Settings },
    ]
  },
];

export default function MainNav() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<string[]>(['المدخلات']);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Auto-expand sections that contain the current route
  useEffect(() => {
    const activeSections = NAV_SECTIONS
      .filter(section => section.items.some(item => pathname.startsWith(item.href)))
      .map(section => section.title);
    if (activeSections.length > 0) {
      setExpandedSections(prev => {
        const newSet = new Set([...prev, ...activeSections]);
        return Array.from(newSet);
      });
    }
  }, [pathname]);

  const toggleSection = (title: string) => {
    setExpandedSections(prev =>
      prev.includes(title)
        ? prev.filter(t => t !== title)
        : [...prev, title]
    );
  };

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname === href || pathname.startsWith(href + '/');
  };

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item.href);
    const Icon = item.icon;

    if (item.disabled) {
      return (
        <div
          key={item.href}
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg cursor-not-allowed opacity-40 select-none',
            isCollapsed && 'justify-center px-2'
          )}
          title={isCollapsed ? item.label : 'قريباً'}
        >
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-800/50">
            <Icon className="w-4 h-4 flex-shrink-0 text-zinc-500" />
          </div>
          {!isCollapsed && (
            <span className="truncate text-zinc-500">{item.label}</span>
          )}
          {!isCollapsed && (
            <span className="mr-auto px-1.5 py-0.5 bg-zinc-700/50 text-zinc-500 text-[10px] font-medium rounded-full border border-zinc-700/50">
              قريباً
            </span>
          )}
        </div>
      );
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileMenuOpen(false)}
        title={isCollapsed ? item.label : undefined}
        className={cn(
          'flex items-center gap-3 text-xs transition-all duration-200 rounded-xl group mb-1 relative',
          isCollapsed ? 'px-2 py-2 justify-center' : 'px-3 py-2',
          active
            ? 'bg-[#D6A84F] text-[#0B0B0D] font-bold'
            : 'text-[#A7A29A] hover:bg-[#2A2A30] hover:text-[#F7F1E5]'
        )}
      >
        {active && !isCollapsed && <div className="w-1.5 h-1.5 rounded-full bg-[#0B0B0D]" />}
        {active && isCollapsed && <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-l-full bg-[#D6A84F]" />}
        <Icon className={cn('w-5 h-5', active ? 'text-[#0B0B0D]' : 'text-[#6B6B6B] group-hover:text-[#D6A84F]')} />
        {!isCollapsed && <span>{item.label}</span>}
      </Link>
    );
  };

  const renderSection = (section: NavSection) => {
    if (isCollapsed) {
      // In collapsed mode, show all items directly without section headers
      return section.items.map(item => (
        <div key={item.href} className="mb-1">
          {renderNavItem(item)}
        </div>
      ));
    }

    const isExpanded = expandedSections.includes(section.title);
    const hasActiveItem = section.items.some(item => isActive(item.href));
    const SectionIcon = section.icon;

    return (
      <div key={section.title} className="mb-2">
        {/* Section Header */}
        <button
          onClick={() => toggleSection(section.title)}
          className={cn(
            'w-full flex items-center justify-between px-3 py-2 text-xs transition-all duration-200 rounded-xl group',
            hasActiveItem
              ? 'bg-[#D6A84F] text-[#0B0B0D] font-bold'
              : 'text-[#A7A29A] hover:bg-[#2A2A30] hover:text-[#F7F1E5]'
          )}
        >
          <div className="flex items-center gap-3">
            {hasActiveItem && <div className="w-1.5 h-1.5 rounded-full bg-[#0B0B0D]" />}
            <SectionIcon className={cn('w-5 h-5', hasActiveItem ? 'text-[#0B0B0D]' : 'text-[#6B6B6B] group-hover:text-[#D6A84F]')} />
            <span>{section.title}</span>
          </div>
          <ChevronDown
            className={cn(
              'w-4 h-4 transition-transform duration-200',
              isExpanded && 'rotate-180',
              hasActiveItem ? 'text-[#0B0B0D]' : 'text-[#6B6B6B]'
            )}
          />
        </button>

        {/* Section Items */}
        <div className={cn(
          'overflow-hidden transition-all duration-200 pr-4',
          isExpanded ? 'max-h-96 opacity-100 mt-1' : 'max-h-0 opacity-0'
        )}>
          <div className="space-y-1 border-r-2 border-[#2A2A30]">
            {section.items.map(item => (
              <div key={item.href} className="mr-2">
                {renderNavItem(item)}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <nav className={cn(
        'hidden lg:flex bg-[#111114] border-l border-[#2A2A30] flex-col shrink-0 transition-all duration-300',
        isCollapsed ? 'w-[60px]' : 'w-[200px]'
      )}>
        {/* Logo Header + Toggle */}
        <div className={cn(
          'flex items-center justify-between transition-all duration-300',
          isCollapsed ? 'p-2 flex-col gap-2' : 'p-4'
        )}>
          <div className={cn(
            'flex items-center justify-center transition-all duration-300',
            isCollapsed ? 'w-10 h-10' : 'w-16 h-16'
          )}>
            <img
              src="/cutsalon.png"
              alt="Cut Salon Logo"
              className="w-full h-full object-contain"
            />
          </div>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={cn(
              'p-1.5 rounded-lg transition-all duration-200 hover:bg-[#2A2A30] text-[#6B6B6B] hover:text-[#F7F1E5]',
              isCollapsed && 'rotate-180'
            )}
            title={isCollapsed ? 'توسيع القائمة' : 'طي القائمة'}
          >
            {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation */}
        <div className={cn(
          'flex-1 py-2 overflow-y-auto space-y-1 scrollbar-luxury-v',
          isCollapsed ? 'px-1.5' : 'px-3'
        )}>
          {NAV_SECTIONS.map(section => renderSection(section))}
        </div>

        {/* Barber Chair Image - Hidden when collapsed */}
        {!isCollapsed && (
          <div className="px-3 py-2">
            <div className="relative rounded-xl overflow-hidden h-80">
              <img
                src="/chair.png"
                alt="Barber Chair"
                className="w-full h-full object-cover"
              />
              {/* Fade from all directions to blend with sidebar */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#111114] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-b from-[#111114] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-l from-[#111114] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#111114] via-transparent to-transparent" />
              {/* Center vignette for extra depth */}
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,#111114_100%)]" />
              {/* Elegant overlay text */}
              <div className="absolute bottom-4 left-4 right-4">
                <div className="bg-black/60 backdrop-blur-sm rounded-lg p-3 text-center">
                  <p className="text-amber-400 font-bold text-sm">Cut Salon</p>
                  <p className="text-white/80 text-xs">صالون حلاقة راقي</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer Button */}
        <div className="p-3 border-t border-[#2A2A30]">
          <button
            className={cn(
              'flex items-center justify-center transition-all duration-200 rounded-xl border border-[#D6A84F]/50 text-[#D6A84F] hover:bg-[#D6A84F]/10',
              isCollapsed ? 'w-full p-2' : 'w-full gap-2 px-3 py-2.5'
            )}
            title="تخصيص القوائم"
          >
            {!isCollapsed && <span className="text-sm">تخصيص القوائم</span>}
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>
      </nav>

      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#111114] border-b border-[#2A2A30]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center">
            <img
              src="/cutsalon.png"
              alt="Cut Salon Logo"
              className="w-full h-full object-contain"
            />
          </div>
          <h2 className="text-lg font-bold text-[#F7F1E5]">CUT SALON</h2>
        </div>

        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 bg-[#1E1D21] border border-[#2A2A30] rounded-lg text-[#A7A29A] hover:bg-[#2A2A30] transition-colors"
        >
          {mobileMenuOpen ? (
            <X className="w-5 h-5" />
          ) : (
            <Menu className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-sm">
          <div className="absolute top-0 right-0 bottom-0 w-[280px] bg-[#111114] border-l border-[#2A2A30] shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-[#2A2A30]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 flex items-center justify-center">
                  <img
                    src="/cutsalon.png"
                    alt="Cut Salon Logo"
                    className="w-full h-full object-contain"
                  />
                </div>
                <h2 className="text-lg font-bold text-[#F7F1E5]">CUT SALON</h2>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 hover:bg-[#2A2A30] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#A7A29A]" />
              </button>
            </div>

            <div className="py-3 px-3 space-y-1 overflow-y-auto max-h-[calc(100vh-200px)]">
              {NAV_SECTIONS.map(section => renderSection(section))}
            </div>

            {/* Mobile Barber Image */}
            <div className="px-3 py-2 mt-auto">
              <div className="relative rounded-xl overflow-hidden h-24">
                <img
                  src="/barber-mohamed.jpg"
                  alt="Barber Chair"
                  className="w-full h-full object-cover opacity-70"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#111114] via-transparent to-transparent" />
              </div>
            </div>

            {/* Mobile Footer Button */}
            <div className="p-3 border-t border-[#2A2A30]">
              <button className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-[#D6A84F]/50 text-[#D6A84F] hover:bg-[#D6A84F]/10 transition-all">
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
