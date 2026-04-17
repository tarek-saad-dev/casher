'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/hooks/useSession';
import LoginForm from '@/components/auth/LoginForm';

export default function LoginPage() {
  const router = useRouter();
  const { setUser, refresh } = useSession();

  // Set page title
  useEffect(() => {
    document.title = 'تسجيل الدخول | نظام نقاط البيع';
  }, []);

  async function handleLoginSuccess(user: { UserID: number; UserName: string; UserLevel: string }) {
    setUser({
      UserID: user.UserID,
      UserName: user.UserName,
      UserLevel: user.UserLevel as 'admin' | 'user',
    });
    await refresh();
    router.push('/');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <LoginForm onSuccess={handleLoginSuccess} />
    </div>
  );
}
