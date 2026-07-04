'use client';

import { useState } from 'react';
import { Loader2, LogIn, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LoginFormProps {
  onSuccess: (user: {
    UserID: number;
    UserName: string;
    UserLevel: string;
    ShiftID?: number | null;
    redirectTo?: string;
    skipShiftPrompt?: boolean;
  }) => void;
}

export default function LoginForm({ onSuccess }: LoginFormProps) {
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!loginName.trim() || !password.trim()) {
      setError('يجب إدخال اسم المستخدم وكلمة المرور');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginName: loginName.trim(), password: password.trim() }),
      });

      const contentType = res.headers.get('content-type') ?? '';
      let data: { error?: string; code?: string; requestId?: string } = {};

      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        console.error('[LoginForm] non-JSON login response', {
          status: res.status,
          contentType,
          preview: text.slice(0, 200),
        });
      }

      if (!res.ok) {
        if (res.status === 404) {
          setError('خدمة تسجيل الدخول غير متاحة. أعد تشغيل الخادم أو تواصل مع الدعم.');
          return;
        }
        if (res.status === 415 || data.code === 'INVALID_CONTENT_TYPE') {
          setError('تعذر إرسال بيانات الدخول بصيغة صحيحة.');
          return;
        }
        if (res.status >= 500) {
          console.error('[LoginForm] server login error', {
            status: res.status,
            code: data.code,
            requestId: data.requestId,
            error: data.error,
          });
        }
        setError(data.error || `تعذر تسجيل الدخول (${res.status})`);
        return;
      }

      onSuccess(data as Parameters<LoginFormProps['onSuccess']>[0]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[LoginForm] network error', { message });
      setError('تعذر الاتصال بالخادم، يرجى التحقق من الإنترنت والمحاولة مرة أخرى');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-[340px] sm:max-w-sm px-4 sm:px-0 space-y-5 sm:space-y-6">
      {/* Logo */}
      <div className="flex flex-col items-center gap-2 sm:gap-3 mb-6 sm:mb-8">
        <div className="flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-primary shadow-lg shadow-primary/25">
          <Scissors className="w-7 h-7 sm:w-8 sm:h-8 text-primary-foreground" />
        </div>
        <div className="text-center">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Hawai Salon</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">نظام نقطة البيع</p>
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-3 sm:space-y-4">
        <div className="space-y-1.5 sm:space-y-2">
          <Label htmlFor="loginName" className="text-sm sm:text-base">اسم المستخدم</Label>
          <Input
            id="loginName"
            type="text"
            autoComplete="username"
            autoFocus
            value={loginName}
            onChange={(e) => setLoginName(e.target.value)}
            placeholder="أدخل اسم المستخدم"
            className="h-12 sm:h-11 text-base w-full"
            dir="ltr"
          />
        </div>

        <div className="space-y-1.5 sm:space-y-2">
          <Label htmlFor="password" className="text-sm sm:text-base">كلمة المرور</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="أدخل كلمة المرور"
            className="h-12 sm:h-11 text-base w-full"
            dir="ltr"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs sm:text-sm text-destructive bg-destructive/10 rounded-lg p-2.5 sm:p-3 text-center">
          {error}
        </div>
      )}

      {/* Submit */}
      <Button
        type="submit"
        className="w-full h-12 sm:h-11 text-base font-bold mt-2"
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 ml-2 animate-spin" />
            جاري الدخول...
          </>
        ) : (
          <>
            <LogIn className="w-5 h-5 ml-2" />
            تسجيل الدخول
          </>
        )}
      </Button>
    </form>
  );
}
