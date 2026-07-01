'use client';

import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/useSession';

interface PartnerOnlyShellProps {
  children: React.ReactNode;
}

export default function PartnerOnlyShell({ children }: PartnerOnlyShellProps) {
  const { logout } = useSession();

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4 print:hidden">
        <p className="text-sm font-medium text-zinc-400 truncate">تقرير الشركاء</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => logout()}
          aria-label="تسجيل الخروج"
          className="gap-1.5 min-h-11 shrink-0 px-3"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          <span className="text-sm">خروج</span>
        </Button>
      </header>
      <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden w-full">
        {children}
      </main>
    </div>
  );
}
