'use client';

import MainNav from '@/components/layout/MainNav';
import ActiveSessionBar from '@/components/session/ActiveSessionBar';
import PartnerOnlyShell from '@/components/layout/PartnerOnlyShell';
import { MobileNavProvider } from '@/components/layout/MobileNavContext';
import { cn } from '@/lib/utils';
import type { UserAccess } from '@/lib/hooks/useMyAccess';

interface AuthenticatedAppShellProps {
  children: React.ReactNode;
  access: UserAccess;
  isPosPage: boolean;
  isOperationsPage: boolean;
}

/**
 * Heavy shell (nav / session bar) — kept out of the /login module graph
 * so first compile of login stays lean.
 */
export default function AuthenticatedAppShell({
  children,
  access,
  isPosPage,
  isOperationsPage,
}: AuthenticatedAppShellProps) {
  if (access.isPartnerOnly) {
    return <PartnerOnlyShell>{children}</PartnerOnlyShell>;
  }

  return (
    <MobileNavProvider>
      <div className={cn(isPosPage && 'max-md:hidden')}>
        <ActiveSessionBar />
      </div>
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
