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
import TenantShellProvider, { useTenantShell } from '@/components/tenant/TenantShellProvider';
import { TenantShellGate, TenantSubscriptionBanner } from '@/components/tenant/TenantShellGate';
import { cn } from '@/lib/utils';
import WhatsAppAttentionProvider from '@/components/layout/WhatsAppAttentionProvider';
import type { UserAccess } from '@/lib/hooks/useMyAccess';

function SetupReturnLink({ access }: { access: UserAccess }) {
  const { snapshot } = useTenantShell();
  const admin = access.userLevel === 'admin' || access.roles.includes('admin') || access.isSuperAdmin;
  if (!admin || !snapshot?.subscription.allowed || snapshot.tenant.industryPackCode !== 'salon' || !/^DRVO_[A-F0-9]{10}$/.test(snapshot.tenant.code)) return null;
  return <div dir="rtl" className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs">
    <span className="text-muted-foreground">تجهيز منشأتك</span>
    <Link href="/setup" className="font-bold text-primary hover:underline">افتح خطوات التجهيز ←</Link>
  </div>;
}

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
          <header dir="rtl" className="flex h-14 items-center justify-between gap-3 border-b border-border bg-card px-4">
            <span className="font-bold text-foreground">واجهة المدير</span>
            <div className="flex items-center gap-2 text-sm">
              <Link href="/admin/hr" className="rounded-lg px-3 py-2 font-medium text-foreground hover:bg-muted">الإدارة</Link>
              <button type="button" onClick={() => logout()} className="min-h-11 rounded-lg px-3 text-muted-foreground hover:bg-destructive-soft hover:text-destructive">خروج</button>
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
        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          <MainNav suppressMobileChrome={isPosPage} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className={cn((isPosPage || isOperationsPage) && 'max-md:hidden')}>
              <ActiveSessionBar />
            </div>
            <OperationalStaleBanner />
            <TenantSubscriptionBanner />
            <SetupReturnLink access={access} />
            <ViewBranchSwitchIndicator />
          <main
            className={cn(
              'flex-1 w-full min-h-0 min-w-0 bg-background',
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
        </div>
        </MobileNavProvider>
      </ShiftOperationalGateProvider>
      </WhatsAppAttentionProvider>
    </OperationalToastProvider>
    </TenantShellProvider>
  );
}
