'use client';

import { useState } from 'react';
import { Loader2, LogIn } from 'lucide-react';
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
          if (data.code === 'SESSION_CONFIG_ERROR') {
            setError(data.error || 'إعداد الجلسة غير مكتمل على الخادم');
            return;
          }
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
    <div className="w-full max-w-[400px] mx-auto">
      <div className="rounded-2xl sm:rounded-3xl bg-white/95 backdrop-blur-sm shadow-2xl shadow-black/20 border border-amber-200/40 overflow-hidden">
        {/* Brand header */}
        <div className="bg-gradient-to-br from-amber-900 via-amber-800 to-amber-950 px-5 pt-8 pb-7 sm:px-8 sm:pt-10 sm:pb-8 text-center">
          <div className="mx-auto mb-4 flex h-[72px] w-[72px] sm:h-20 sm:w-20 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-amber-400/30 shadow-lg shadow-black/20">
            <img
              src="/cutsalon.png"
              alt="Cut Salon"
              className="h-14 w-14 sm:h-16 sm:w-16 object-contain drop-shadow-md"
            />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-wide text-amber-50">
            Cut Salon System
          </h1>
          <p className="mt-1.5 text-sm text-amber-200/80">نظام إدارة الصالون</p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="px-5 py-6 sm:px-8 sm:py-8 space-y-5"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="loginName" className="text-sm font-medium text-stone-700">
                اسم المستخدم
              </Label>
              <Input
                id="loginName"
                type="text"
                autoComplete="username"
                autoFocus
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                placeholder="أدخل اسم المستخدم"
                className="h-12 text-base w-full bg-stone-50 border-stone-200 focus-visible:border-amber-500 focus-visible:ring-amber-500/30 rounded-xl"
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-stone-700">
                كلمة المرور
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="أدخل كلمة المرور"
                className="h-12 text-base w-full bg-stone-50 border-stone-200 focus-visible:border-amber-500 focus-visible:ring-amber-500/30 rounded-xl"
                dir="ltr"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 text-center leading-relaxed"
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full h-12 text-base font-bold rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white shadow-lg shadow-amber-900/20 active:scale-[0.98] transition-transform"
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
      </div>

      <p className="mt-5 text-center text-xs text-amber-200/60 px-4">
        Cut Salon &mdash; نظام نقاط البيع
      </p>
    </div>
  );
}
