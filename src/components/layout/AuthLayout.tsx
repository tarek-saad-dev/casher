'use client';

import { usePathname } from 'next/navigation';
import MainNav from '@/components/layout/MainNav';
import ActiveSessionBar from '@/components/session/ActiveSessionBar';
import PartnerOnlyShell from '@/components/layout/PartnerOnlyShell';
import { usePermissions } from '@/components/providers/PermissionsProvider';

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  const pathname = usePathname();
  const { access, loading, isAuthenticated } = usePermissions();

  const isLoginPage = pathname === '/login';

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
      <ActiveSessionBar />
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        <MainNav />
        <main className="flex-1 overflow-y-auto w-full">
          {children}
        </main>
      </div>
    </>
  );
}
