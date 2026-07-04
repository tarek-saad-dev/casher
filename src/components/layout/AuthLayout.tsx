'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import MainNav from '@/components/layout/MainNav';
import ActiveSessionBar from '@/components/session/ActiveSessionBar';
import PartnerOnlyShell from '@/components/layout/PartnerOnlyShell';
import { usePermissions } from '@/components/providers/PermissionsProvider';
import { useSession } from '@/hooks/useSession';
import { cn } from '@/lib/utils';
import { MobileNavProvider } from '@/components/layout/MobileNavContext';

const AUTH_DEBUG = process.env.NODE_ENV === 'development';

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  const pathname = usePathname();
  const { loading: sessionLoading, isAuthenticated: sessionAuth } = useSession();
  const { access, loading: permLoading } = usePermissions();

  const isLoginPage = pathname === '/login';
  const isPosPage = pathname === '/income/pos';
  const isOperationsPage = pathname === '/operations' || pathname.startsWith('/operations/');

  const authResolving = sessionLoading || (sessionAuth && permLoading);

  useEffect(() => {
    if (!AUTH_DEBUG) return;
    console.info('[AuthLayout] state', {
      pathname,
      sessionLoading,
      sessionAuth,
      permLoading,
      hasAccess: !!access,
      showNav: !authResolving && !isLoginPage,
    });
  }, [pathname, sessionLoading, sessionAuth, permLoading, access, authResolving, isLoginPage]);

  if (isLoginPage) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {children}
      </div>
    );
  }

  if (authResolving) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0 bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-label="جاري التحميل" />
      </div>
    );
  }

  if (access?.isPartnerOnly) {
    return <PartnerOnlyShell>{children}</PartnerOnlyShell>;
  }

  return (
    <MobileNavProvider>
      <div className={cn(isPosPage && 'max-md:hidden')}>
        <ActiveSessionBar />
      </div>
      {/* Responsive layout: column on mobile (nav header on top), sidebar on desktop */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        <MainNav suppressMobileChrome={isPosPage} />
        <main
          className={cn(
            'flex-1 w-full min-h-0 min-w-0',
            isOperationsPage
              ? 'overflow-hidden'
              : isPosPage
                ? 'max-md:overflow-hidden overflow-y-auto'
                : 'overflow-y-auto',
          )}
        >
          {children}
        </main>
      </div>
    </MobileNavProvider>
  );
}
