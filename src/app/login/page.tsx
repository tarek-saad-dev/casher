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
    document.title = 'تسجيل الدخول | نظام نقاط البيع';
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
  }) {
    setLoading(true);
    try {
      setUser({
        UserID: loginUser.UserID,
        UserName: loginUser.UserName,
        UserLevel: loginUser.UserLevel as 'admin' | 'user',
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

  // Show OpenShiftPrompt if logged in but needs shift/day
  if (loginData && sessionState) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background p-3 sm:p-4 min-h-0 overflow-y-auto">
        <OpenShiftPrompt
          userName={loginData.UserName}
          defaultShiftId={loginData.ShiftID ?? null}
          hasOpenDay={sessionState.hasOpenDay}
          isAdmin={loginData.UserLevel === 'admin'}
          onOpenShift={handleOpenShift}
          onOpenDay={handleOpenDay}
          onLogout={logout}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-background p-3 sm:p-4 min-h-0 overflow-y-auto">
      <LoginForm onSuccess={handleLoginSuccess} />
    </div>
  );
}
