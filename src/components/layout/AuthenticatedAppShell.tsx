'use client';

import { usePathname } from 'next/navigation';
import { useSession } from '@/hooks/useSession';
import Link from 'next/link';
import MainNav from '@/components/layout/MainNav';
import ActiveSessionBar from '@/components/session/ActiveSessionBar';
import OperationalStaleBanner from '@/components/session/OperationalStaleBanner';
import ViewBranchSwitchIndicator from '@/components/session/ViewBranchSwitchIndicator';
import ShiftOperationalGateProvider from '@/components/session/ShiftOperationalGateProvider';
import { OperationalToastProvider } from '@/components/session/OperationalToast';
import PartnerOnlyShell from '@/components/layout/PartnerOnlyShell';
import { MobileNavProvider } from '@/components/layout/MobileNavContext';
import TenantShellProvider from '@/components/tenant/TenantShellProvider';
import { TenantShellGate, TenantSubscriptionBanner } from '@/components/tenant/TenantShellGate';
import { cn } from '@/lib/utils';
import WhatsAppAttentionProvider from '@/components/layout/WhatsAppAttentionProvider';
import type { UserAccess } from '@/lib/hooks/useMyAccess';

interface AuthenticatedAppShellProps {
  children: React.ReactNode;
  access: UserAccess;
  isPosPage: boolean;
  isOperationsPage: boolean;
  /** WhatsApp Inbox owns its own pane scroll — lock `<main>` like Operations. */
  isWhatsAppInboxPage?: boolean;
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
  isWhatsAppInboxPage = false,
}: AuthenticatedAppShellProps) {
  const pathname = usePathname();
  const { logout } = useSession();
  if (pathname === '/manager') {
    return (
      <TenantShellProvider>
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <header dir="rtl" className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <span className="font-semibold">واجهة المدير</span>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/admin/hr" className="py-2">الإدارة</Link>
              <button onClick={() => logout()} className="min-h-11 px-3">خروج</button>
            </div>
          </header>
          <main className="flex-1 min-h-0 overflow-auto">
            <TenantShellGate>{children}</TenantShellGate>
          </main>
        </div>
      </TenantShellProvider>
    );
  }
  if (access.isPartnerOnly) {
    return (
      <TenantShellProvider>
        <PartnerOnlyShell>
          <TenantShellGate>{children}</TenantShellGate>
        </PartnerOnlyShell>
      </TenantShellProvider>
    );
  }

  const lockMainToViewport = isOperationsPage || isWhatsAppInboxPage;

  return (
    <TenantShellProvider>
    <OperationalToastProvider>
      <WhatsAppAttentionProvider>
      <ShiftOperationalGateProvider>
        <MobileNavProvider>
        <div className={cn((isPosPage || isOperationsPage) && 'max-md:hidden')}>
          <ActiveSessionBar />
        </div>
        <OperationalStaleBanner />
        <TenantSubscriptionBanner />
        <ViewBranchSwitchIndicator />
        <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
          <MainNav suppressMobileChrome={isPosPage} />
          <main
            className={cn(
              'flex-1 w-full min-h-0 min-w-0',
              lockMainToViewport
                ? 'flex flex-col overflow-hidden'
                : isPosPage
                  ? 'max-md:overflow-hidden overflow-y-auto'
                  : 'overflow-y-auto',
            )}
          >
            <TenantShellGate>{children}</TenantShellGate>
          </main>
        </div>
        </MobileNavProvider>
      </ShiftOperationalGateProvider>
      </WhatsAppAttentionProvider>
    </OperationalToastProvider>
    </TenantShellProvider>
  );
}
