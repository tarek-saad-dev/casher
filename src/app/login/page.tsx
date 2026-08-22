'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/hooks/useSession';
import { usePermissions } from '@/components/providers/PermissionsProvider';
import LoginForm from '@/components/auth/LoginForm';
import OpenShiftPrompt from '@/components/auth/OpenShiftPrompt';

const AUTH_DEBUG = process.env.NODE_ENV === 'development';

interface LoginData {
  UserID: number;
  UserName: string;
  UserLevel: 'admin' | 'user';
  ShiftID?: number | null;
  redirectTo?: string;
  skipShiftPrompt?: boolean;
}

export default function LoginPage() {
  const router = useRouter();
  const { setUser, refresh, logout, openMyShift, user, isAuthenticated } = useSession();
  const { reload: reloadPermissions } = usePermissions();
  const [loginData, setLoginData] = useState<LoginData | null>(null);
  const [sessionState, setSessionState] = useState<{
    hasOpenDay: boolean;
    hasOpenShift: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  // Set page title
  useEffect(() => {
    document.title = 'تسجيل الدخول | Cut Salon System';
  }, []);

  async function navigateAfterLogin(path: string) {
    await reloadPermissions();
    if (AUTH_DEBUG) {
      console.info('[login] session before redirect', {
        isAuthenticated,
        userId: user?.UserID,
        userName: user?.UserName,
        target: path,
      });
    }
    router.replace(path);
    router.refresh();
  }

  async function handleLoginSuccess(loginUser: {
    UserID: number;
    UserName: string;
    UserLevel: string;
    ShiftID?: number | null;
    redirectTo?: string;
    skipShiftPrompt?: boolean;
    ActiveBranchID?: number;
    ActiveBranchCode?: string;
    BranchSessionVersion?: 1;
  }) {
    setLoading(true);
    try {
      if (loginUser.ActiveBranchID == null || !loginUser.ActiveBranchCode) {
        throw new Error('Login response missing active branch metadata');
      }
      setUser({
        UserID: loginUser.UserID,
        UserName: loginUser.UserName,
        UserLevel: loginUser.UserLevel as 'admin' | 'user',
        ActiveBranchID: loginUser.ActiveBranchID,
        ActiveBranchCode: loginUser.ActiveBranchCode,
        BranchSessionVersion: loginUser.BranchSessionVersion ?? 1,
        defaultShiftId: loginUser.ShiftID ?? undefined,
      });

      await refresh();

      if (AUTH_DEBUG) {
        console.info('[login] session refreshed', { userId: loginUser.UserID });
      }

      if (loginUser.skipShiftPrompt) {
        await navigateAfterLogin(loginUser.redirectTo ?? '/admin/reports/partners');
        return;
      }

      const sessionRes = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
      const sessionData = await sessionRes.json();

      const hasOpenDay = !!sessionData.day;
      const hasOpenShift = !!sessionData.shift;

      if (hasOpenDay && hasOpenShift) {
        await navigateAfterLogin(loginUser.redirectTo ?? '/');
        return;
      }

      await reloadPermissions();

      setSessionState({ hasOpenDay, hasOpenShift });
      setLoginData({
        UserID: loginUser.UserID,
        UserName: loginUser.UserName,
        UserLevel: loginUser.UserLevel as 'admin' | 'user',
        ShiftID: loginUser.ShiftID,
        redirectTo: loginUser.redirectTo,
        skipShiftPrompt: loginUser.skipShiftPrompt,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenShift(shiftId: number) {
    await openMyShift(shiftId);
    await navigateAfterLogin(loginData?.redirectTo ?? '/');
  }

  async function handleOpenDay() {
    const res = await fetch('/api/day/open', { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'فشل فتح يوم العمل');
    }
    // Refresh session state
    await refresh();
    const sessionRes = await fetch('/api/auth/session');
    const sessionData = await sessionRes.json();
    setSessionState({
      hasOpenDay: !!sessionData.day,
      hasOpenShift: !!sessionData.shift,
    });
  }

  const loginShell = (
    <div className="relative flex-1 flex flex-col min-h-0 overflow-y-auto bg-gradient-to-br from-amber-950 via-amber-900 to-stone-950">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 h-48 w-48 rounded-full bg-amber-300/5 blur-2xl" />
      </div>
      <div className="relative flex-1 flex items-center justify-center px-4 py-6 min-h-0 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {loginData && sessionState ? (
          <OpenShiftPrompt
            userName={loginData.UserName}
            defaultShiftId={loginData.ShiftID ?? null}
            hasOpenDay={sessionState.hasOpenDay}
            isAdmin={loginData.UserLevel === 'admin'}
            onOpenShift={handleOpenShift}
            onOpenDay={handleOpenDay}
            onLogout={logout}
          />
        ) : (
          <LoginForm onSuccess={handleLoginSuccess} />
        )}
      </div>
    </div>
  );

  return loginShell;
}
