'use client';

import { usePathname } from 'next/navigation';
import MainNav from '@/components/layout/MainNav';
import ActiveSessionBar from '@/components/session/ActiveSessionBar';
import PartnerOnlyShell from '@/components/layout/PartnerOnlyShell';
import { usePermissions } from '@/components/providers/PermissionsProvider';
import { cn } from '@/lib/utils';

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  const pathname = usePathname();
  const { access, loading, isAuthenticated } = usePermissions();

  const isLoginPage = pathname === '/login';
  const isPosPage = pathname === '/income/pos';

  if (isLoginPage) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {children}
      </div>
    );
  }

  const awaitingAccess = isAuthenticated && loading && !access;

  if (awaitingAccess) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {children}
      </div>
    );
  }

  if (access?.isPartnerOnly) {
    return <PartnerOnlyShell>{children}</PartnerOnlyShell>;
  }

  return (
    <>
      <div className={cn(isPosPage && 'max-md:hidden')}>
        <ActiveSessionBar />
      </div>
      {/* Responsive layout: column on mobile (nav header on top), sidebar on desktop */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        <MainNav suppressMobileChrome={isPosPage} />
        <main
          className={cn(
            'flex-1 w-full',
            isPosPage ? 'max-md:overflow-hidden overflow-y-auto' : 'overflow-y-auto',
          )}
        >
          {children}
        </main>
      </div>
    </>
  );
}
