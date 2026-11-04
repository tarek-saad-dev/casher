'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, House, LogOut, Scissors, Settings2 } from 'lucide-react';

const items = [
  { href: '/employee-portal', label: 'الرئيسية', icon: House },
  { href: '/employee-portal/bookings', label: 'الحجوزات', icon: CalendarDays },
  { href: '/employee-portal/account-settings', label: 'الإعدادات', icon: Settings2 },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  if (href === '/employee-portal') return pathname === href;
  if (href.endsWith('/account-settings') && pathname.startsWith('/employee-portal/change-password')) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function EmployeePortalNav({ placement }: { placement: 'header' | 'bottom' }) {
  const pathname = usePathname() || '/employee-portal';

  if (placement === 'bottom') {
    return (
      <nav
        aria-label="التنقل السريع للموظف"
        className="z-20 shrink-0 border-t border-white/10 bg-[#141416] px-3 pt-2 shadow-[0_-12px_35px_rgba(0,0,0,0.3)] md:hidden"
        style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto grid max-w-lg grid-cols-3 gap-2">
          {items.map(({ href, label, icon: Icon }) => {
            const current = isCurrent(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? 'page' : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${current
                  ? 'bg-amber-400/12 text-amber-300'
                  : 'text-zinc-400 active:bg-white/10'}`}
              >
                <Icon aria-hidden="true" size={21} strokeWidth={current ? 2.3 : 1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <header className="z-10 shrink-0 border-b border-white/10 bg-[#141416]">
      <div className="mx-auto flex min-h-[64px] max-w-6xl items-center justify-between gap-3 px-4 md:px-10">
        <Link
          href="/employee-portal"
          aria-label="العودة إلى الرئيسية - CUT STAFF"
          className="flex min-w-0 items-center gap-2.5 rounded-xl focus-visible:outline-2 focus-visible:outline-amber-400"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-amber-400/30 bg-amber-400/10 text-amber-300">
            <Scissors aria-hidden="true" size={20} strokeWidth={2} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-black tracking-wider text-white" dir="ltr">CUT STAFF</span>
            <span className="block text-[11px] text-zinc-400">بوابة الموظفين</span>
          </span>
        </Link>

        <nav aria-label="صفحات الموظف" className="hidden items-center gap-2 md:flex">
          {items.map(({ href, label, icon: Icon }) => {
            const current = isCurrent(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 ${current
                  ? 'bg-amber-400/15 text-amber-300'
                  : 'text-zinc-300 hover:bg-white/5 hover:text-white'}`}
              >
                <Icon size={17} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>

        <form action="/employee-portal/logout" method="post">
          <button
            type="submit"
            aria-label="تسجيل الخروج"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/10 px-3 text-zinc-300 transition-colors hover:border-rose-400/40 hover:text-rose-200 focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            <LogOut size={18} aria-hidden="true" />
            <span className="hidden text-sm font-semibold sm:inline">خروج</span>
          </button>
        </form>
      </div>
    </header>
  );
}
