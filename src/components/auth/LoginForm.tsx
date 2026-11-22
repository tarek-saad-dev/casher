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
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        {/* Brand header (Deep Plum, on-dark treatment) */}
        <div className="bg-brand-deep px-5 pt-7 pb-6 text-center sm:px-8 sm:pt-8">
          <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-xl bg-card shadow-sm">
            <img
              src="/cutsalon.png"
              alt="Cut Salon"
              className="size-12 object-contain"
            />
          </div>
          <h1 className="text-xl font-bold text-brand-foreground">
            Cut Salon System
          </h1>
          <p className="mt-1 text-sm text-brand-foreground/80">نظام إدارة الصالون</p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="space-y-5 px-5 py-6 sm:px-8 sm:py-7"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="loginName" className="text-sm font-semibold text-foreground">
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
                className="h-11 w-full rounded-lg bg-card text-base"
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-semibold text-foreground">
                كلمة المرور
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="أدخل كلمة المرور"
                className="h-11 w-full rounded-lg bg-card text-base"
                dir="ltr"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive-soft p-3 text-center text-sm leading-relaxed text-destructive"
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            size="xl"
            className="w-full font-bold"
            disabled={loading}
            aria-busy={loading || undefined}
          >
            {loading ? (
              <>
                <Loader2 className="size-5 animate-spin" aria-hidden />
                جاري الدخول...
              </>
            ) : (
              <>
                <LogIn className="size-5" aria-hidden />
                تسجيل الدخول
              </>
            )}
          </Button>
        </form>
      </div>

      <p className="mt-5 px-4 text-center text-xs text-muted-foreground">
        Cut Salon &mdash; نظام نقاط البيع
      </p>
    </div>
  );
}
