'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Receipt, 
  Calculator, 
  CalendarDays, 
  Clock, 
  Users, 
  Wallet,
  FileText,
  ChevronDown,
  Menu,
  X,
  TrendingUp
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: any;
  badge?: string;
  children?: NavItem[];
}

const NAV_STRUCTURE: NavItem[] = [
  {
    href: '/',
    label: 'نقطة البيع',
    icon: LayoutDashboard,
  },
  {
    href: '/sales/today',
    label: 'مبيعات اليوم',
    icon: TrendingUp,
  },
  {
    href: '/expenses',
    label: 'المصروفات',
    icon: Receipt,
  },
  {
    href: '/treasury',
    label: 'الخزنة',
    icon: Wallet,
    children: [
      {
        href: '/treasury/daily',
        label: 'قفل اليوم',
        icon: Wallet,
      }
    ]
  },
  {
    href: '/reports',
    label: 'التقارير',
    icon: FileText,
    children: [
      {
        href: '/reports/expenses/monthly',
        label: 'تقرير المصروفات الشهري',
        icon: Receipt,
      }
    ]
  },
  {
    href: '/budget',
    label: 'الميزانية',
    icon: Calculator,
  },
  {
    href: '/admin',
    label: 'الإدارة',
    icon: Users,
    children: [
      {
        href: '/admin/day',
        label: 'يوم العمل',
        icon: CalendarDays,
      },
      {
        href: '/admin/shift',
        label: 'الورديات',
        icon: Clock,
      },
      {
        href: '/admin/users',
        label: 'المستخدمين',
        icon: Users,
      }
    ]
  }
];

export default function MainNav() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSection = (href: string) => {
    setExpandedSections(prev => 
      prev.includes(href) 
        ? prev.filter(h => h !== href)
        : [...prev, href]
    );
  };

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname.startsWith(href);
  };

  const renderNavItem = (item: NavItem, level: number = 0) => {
    const active = isActive(item.href);
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedSections.includes(item.href);
    const Icon = item.icon;
    const isCollapsed = sidebarCollapsed;

    if (hasChildren) {
      return (
        <div key={item.href}>
          <button
            onClick={() => {
              if (!isCollapsed) toggleSection(item.href);
            }}
            className={cn(
              'w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors rounded-lg',
              active
                ? 'bg-amber-500/10 text-amber-400 font-medium'
                : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-white',
              isCollapsed && 'justify-center'
            )}
            title={isCollapsed ? item.label : undefined}
          >
            <div className={cn('flex items-center gap-3', isCollapsed && 'gap-0')}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!isCollapsed && <span>{item.label}</span>}
            </div>
            {!isCollapsed && (
              <ChevronDown 
                className={cn(
                  'w-4 h-4 transition-transform',
                  isExpanded && 'rotate-180'
                )} 
              />
            )}
          </button>
          
          {!isCollapsed && isExpanded && (
            <div className="mr-4 mt-1 space-y-0.5">
              {item.children?.map(child => renderNavItem(child, level + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileMenuOpen(false)}
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 text-sm transition-colors rounded-lg',
          level > 0 && 'pr-8',
          active
            ? 'bg-amber-500/10 text-amber-400 font-medium'
            : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-white',
          isCollapsed && 'justify-center'
        )}
        title={isCollapsed ? item.label : undefined}
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        {!isCollapsed && <span>{item.label}</span>}
        {!isCollapsed && item.badge && (
          <span className="mr-auto px-2 py-0.5 bg-rose-500/10 text-rose-400 text-xs font-medium rounded-full">
            {item.badge}
          </span>
        )}
      </Link>
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
          {NAV_STRUCTURE.map(item => renderNavItem(item))}
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
              {NAV_STRUCTURE.map(item => renderNavItem(item))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
