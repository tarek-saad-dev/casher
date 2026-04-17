'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  // Income
  Coins,
  PlusCircle,
  CreditCard,
  // Income Review
  ClipboardList,
  TrendingUp,
  CalendarDays,
  History,
  // Expenses
  Receipt,
  Banknote,
  FileMinus,
  // Expenses Review
  PieChart,
  Users,
  Wallet,
  // Treasury
  Lock,
  ArrowLeftRight,
  BarChart3,
  Clock,
  // Admin
  Settings,
  Scissors,
  Tags,
  Shield,
  // System
  ChevronDown,
  Menu,
  X,
  LayoutGrid
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: any;
  badge?: string;
  children?: NavItem[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// New Navigation Structure based on Financial Flow
const NAV_SECTIONS: NavSection[] = [
  {
    title: 'المدخلات',
    items: [
      {
        href: '/income/pos',
        label: 'نقطة البيع',
        icon: LayoutGrid,
      },
      {
        href: '/income/new',
        label: 'إيراد جديد',
        icon: PlusCircle,
      },
      {
        href: '/income/collection',
        label: 'تحصيل / دفعة',
        icon: CreditCard,
      },
    ]
  },
  {
    title: 'مراجعة المدخلات',
    items: [
      {
        href: '/income-review/today-sales',
        label: 'مبيعات اليوم',
        icon: TrendingUp,
      },
      {
        href: '/income-review/all-sales',
        label: 'كل المبيعات',
        icon: History,
      },
      {
        href: '/income-review/today-revenue',
        label: 'إيرادات اليوم',
        icon: Coins,
      },
      {
        href: '/income-review/all-revenue',
        label: 'كل الإيرادات',
        icon: CalendarDays,
      },
      {
        href: '/income-review/payments',
        label: 'المدفوعات والتحصيلات',
        icon: ClipboardList,
      },
    ]
  },
  {
    title: 'المصروفات',
    items: [
      {
        href: '/expenses/salaries',
        label: 'مرتبات العاملين',
        icon: Users,
      },
      {
        href: '/expenses/new',
        label: 'مصروف جديد',
        icon: Receipt,
      },
      {
        href: '/expenses/fixed',
        label: 'المصروفات الثابتة',
        icon: FileMinus,
      },
    ]
  },
  {
    title: 'مراجعة المصروفات',
    items: [
      {
        href: '/expenses-review/report',
        label: 'تقرير المصروفات',
        icon: PieChart,
      },
      {
        href: '/expenses-review/salaries',
        label: 'تقرير المرتبات',
        icon: Banknote,
      },
      {
        href: '/expenses-review/advances',
        label: 'السلف والخصومات',
        icon: Wallet,
      },
    ]
  },
  {
    title: 'الخزنة',
    items: [
      {
        href: '/treasury/daily-close',
        label: 'تقفيل اليوم',
        icon: Lock,
      },
      {
        href: '/treasury/movement',
        label: 'حركة الخزنة',
        icon: ArrowLeftRight,
      },
      {
        href: '/treasury/summary',
        label: 'ملخص حسب الدفع',
        icon: BarChart3,
      },
      {
        href: '/treasury/shift-close',
        label: 'تقفيل الوردية',
        icon: Clock,
      },
    ]
  },
  {
    title: 'الإدارة',
    items: [
      {
        href: '/admin/employees',
        label: 'الموظفون',
        icon: Users,
      },
      {
        href: '/admin/users',
        label: 'المستخدمون والصلاحيات',
        icon: Shield,
      },
      {
        href: '/admin/services',
        label: 'الخدمات',
        icon: Scissors,
      },
      {
        href: '/admin/payment-methods',
        label: 'طرق الدفع',
        icon: CreditCard,
      },
      {
        href: '/admin/categories',
        label: 'التصنيفات',
        icon: Tags,
      },
      {
        href: '/admin/shift',
        label: 'الورديات',
        icon: Clock,
      },
      {
        href: '/admin/settings',
        label: 'الإعدادات العامة',
        icon: Settings,
      },
    ]
  },
];

export default function MainNav() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Auto-expand sections that contain the current route
  useEffect(() => {
    const activeSections = NAV_SECTIONS
      .filter(section => section.items.some(item => pathname.startsWith(item.href)))
      .map(section => section.title);
    setExpandedSections(prev => [...new Set([...prev, ...activeSections])]);
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
    return pathname.startsWith(href);
  };

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item.href);
    const Icon = item.icon;
    const isCollapsed = sidebarCollapsed;

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileMenuOpen(false)}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 text-sm transition-all duration-200 rounded-lg group',
          active
            ? 'bg-gradient-to-r from-amber-500/20 to-amber-500/5 text-amber-400 font-medium border-r-2 border-amber-500'
            : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-white',
          isCollapsed && 'justify-center px-2'
        )}
        title={isCollapsed ? item.label : undefined}
      >
        <div className={cn(
          'flex items-center justify-center w-8 h-8 rounded-lg transition-colors',
          active ? 'bg-amber-500/20' : 'bg-zinc-800/50 group-hover:bg-zinc-700/50'
        )}>
          <Icon className="w-4 h-4 flex-shrink-0" />
        </div>
        {!isCollapsed && <span className="truncate">{item.label}</span>}
        {!isCollapsed && item.badge && (
          <span className="mr-auto px-2 py-0.5 bg-rose-500/10 text-rose-400 text-xs font-medium rounded-full">
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  const renderSection = (section: NavSection) => {
    const isExpanded = expandedSections.includes(section.title);
    const isCollapsed = sidebarCollapsed;
    const hasActiveItem = section.items.some(item => isActive(item.href));

    // Get section icon based on title
    let SectionIcon = LayoutGrid;
    if (section.title === 'المدخلات') SectionIcon = Coins;
    if (section.title === 'مراجعة المدخلات') SectionIcon = TrendingUp;
    if (section.title === 'المصروفات') SectionIcon = Receipt;
    if (section.title === 'مراجعة المصروفات') SectionIcon = PieChart;
    if (section.title === 'الخزنة') SectionIcon = Wallet;
    if (section.title === 'الإدارة') SectionIcon = Settings;

    return (
      <div key={section.title} className="mb-1">
        {isCollapsed ? (
          // Collapsed: Show icon only for section
          <div className="px-2 py-2">
            <button
              onClick={() => toggleSection(section.title)}
              className={cn(
                'w-full flex items-center justify-center p-2 rounded-lg transition-colors',
                hasActiveItem ? 'text-amber-400 bg-amber-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'
              )}
              title={section.title}
            >
              <SectionIcon className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <>
            {/* Section Header */}
            <button
              onClick={() => toggleSection(section.title)}
              className={cn(
                'w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors rounded-lg',
                hasActiveItem ? 'text-amber-400/90' : 'text-zinc-500',
                'hover:text-zinc-300'
              )}
            >
              <div className="flex items-center gap-2">
                <SectionIcon className="w-3.5 h-3.5" />
                <span>{section.title}</span>
              </div>
              <ChevronDown
                className={cn(
                  'w-3.5 h-3.5 transition-transform duration-200',
                  isExpanded && 'rotate-180'
                )}
              />
            </button>

            {/* Section Items */}
            <div className={cn(
              'overflow-hidden transition-all duration-200',
              isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
            )}>
              <div className="mt-1 space-y-0.5">
                {section.items.map(item => renderNavItem(item))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <nav className={cn(
        'hidden lg:flex bg-gradient-to-b from-zinc-900/95 to-zinc-900/90 border-l border-zinc-800/50 flex-col shrink-0 transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}>
        {/* Header */}
        <div className="p-4 border-b border-zinc-800/50">
          <div className="flex items-center justify-between">
            {!sidebarCollapsed && (
              <div>
                <h2 className="text-lg font-bold text-white">Cut Salon</h2>
                <p className="text-xs text-zinc-500 mt-0.5">نظام إدارة الصالون</p>
              </div>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 hover:bg-zinc-800/40 rounded-lg transition-colors text-zinc-400 hover:text-white"
              title={sidebarCollapsed ? 'فتح الشريط الجانبي' : 'طي الشريط الجانبي'}
            >
              <Menu className={cn('w-4 h-4 transition-transform', sidebarCollapsed && 'rotate-180')} />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 py-3 px-3 space-y-1 overflow-y-auto">
          {NAV_SECTIONS.map(section => renderSection(section))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800/50">
          {!sidebarCollapsed ? (
            <div className="text-xs text-zinc-500">
              <p>الإصدار 2.0</p>
              <p className="mt-1">© 2026 Cut Salon</p>
            </div>
          ) : (
            <div className="text-center text-xs text-zinc-500">
              <p>v2.0</p>
            </div>
          )}
        </div>
      </nav>

      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-gradient-to-b from-zinc-900/95 to-zinc-900/90 border-b border-zinc-800/50">
        <div>
          <h2 className="text-lg font-bold text-white">Cut Salon</h2>
          <p className="text-xs text-zinc-500">نظام إدارة الصالون</p>
        </div>

        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 bg-zinc-800/40 border border-zinc-700/30 rounded-lg text-zinc-400 hover:bg-zinc-800/60 transition-colors"
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
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm">
          <div className="absolute top-0 right-0 bottom-0 w-80 bg-gradient-to-b from-zinc-900/95 to-zinc-900/90 border-l border-zinc-800/50 shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800/50">
              <div>
                <h2 className="text-lg font-bold text-white">القائمة</h2>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 hover:bg-zinc-800/40 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-zinc-400" />
              </button>
            </div>

            <div className="py-3 px-3 space-y-1 overflow-y-auto max-h-[calc(100vh-80px)]">
              {NAV_SECTIONS.map(section => renderSection(section))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
