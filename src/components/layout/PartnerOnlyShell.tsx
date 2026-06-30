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
    <div className="flex flex-col flex-1 min-h-0">
      <header className="flex shrink-0 items-center justify-end border-b border-border px-3 py-2 sm:px-4 print:hidden">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => logout()}
          className="gap-2"
        >
          <LogOut className="h-4 w-4" />
          تسجيل الخروج
        </Button>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto w-full">
        {children}
      </main>
    </div>
  );
}
