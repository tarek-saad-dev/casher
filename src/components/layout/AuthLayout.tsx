'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { usePermissions } from '@/components/providers/PermissionsProvider';
import { useSession } from '@/hooks/useSession';

const AUTH_DEBUG = process.env.NODE_ENV === 'development';

const AuthenticatedAppShell = dynamic(
  () => import('@/components/layout/AuthenticatedAppShell'),
  {
    loading: () => (
      <div className="flex-1 flex items-center justify-center min-h-0 bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-label="جاري التحميل" />
      </div>
    ),
  },
);

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
  const isWhatsAppInboxPage =
    pathname === '/admin/whatsapp/inbox' || pathname.startsWith('/admin/whatsapp/inbox/');

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

  if (authResolving || !access) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0 bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-label="جاري التحميل" />
      </div>
    );
  }

  return (
    <AuthenticatedAppShell
      access={access}
      isPosPage={isPosPage}
      isOperationsPage={isOperationsPage}
      isWhatsAppInboxPage={isWhatsAppInboxPage}
    >
      {children}
    </AuthenticatedAppShell>
  );
}
