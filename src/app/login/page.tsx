'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/hooks/useSession';
import LoginForm from '@/components/auth/LoginForm';
import OpenShiftPrompt from '@/components/auth/OpenShiftPrompt';

interface LoginData {
  UserID: number;
  UserName: string;
  UserLevel: 'admin' | 'user';
  ShiftID?: number | null;
}

export default function LoginPage() {
  const router = useRouter();
  const { setUser, refresh, logout, openMyShift } = useSession();
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

  async function handleLoginSuccess(user: { UserID: number; UserName: string; UserLevel: string; ShiftID?: number | null }) {
    setLoading(true);
    try {
      // Set user in context including default shift ID
      setUser({
        UserID: user.UserID,
        UserName: user.UserName,
        UserLevel: user.UserLevel as 'admin' | 'user',
        defaultShiftId: user.ShiftID ?? undefined,
      });

      // Refresh session to get day and shift status
      await refresh();

      // Fetch current session state
      const sessionRes = await fetch('/api/auth/session');
      const sessionData = await sessionRes.json();

      const hasOpenDay = !!sessionData.day;
      const hasOpenShift = !!sessionData.shift;

      // If user has open shift and day, proceed to main page
      if (hasOpenDay && hasOpenShift) {
        router.push('/');
        return;
      }

      // Otherwise show OpenShiftPrompt
      setSessionState({ hasOpenDay, hasOpenShift });
      setLoginData({
        UserID: user.UserID,
        UserName: user.UserName,
        UserLevel: user.UserLevel as 'admin' | 'user',
        ShiftID: user.ShiftID,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenShift(shiftId: number) {
    await openMyShift(shiftId);
    router.push('/');
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
