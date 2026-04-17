'use client';

import { useState } from 'react';
import { Loader2, LogIn, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LoginFormProps {
  onSuccess: (user: { UserID: number; UserName: string; UserLevel: string }) => void;
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
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'تعذر الاتصال بالخادم، حاول مرة أخرى');
        return;
      }
      onSuccess(data);
    } catch {
      setError('تعذر الاتصال بالخادم، يرجى التحقق من الإنترنت والمحاولة مرة أخرى');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
      {/* Logo */}
      <div className="flex flex-col items-center gap-3 mb-8">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary shadow-lg">
          <Scissors className="w-8 h-8 text-primary-foreground" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Hawai Salon</h1>
          <p className="text-sm text-muted-foreground">نظام نقطة البيع</p>
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="loginName">اسم المستخدم</Label>
          <Input
            id="loginName"
            type="text"
            autoComplete="username"
            autoFocus
            value={loginName}
            onChange={(e) => setLoginName(e.target.value)}
            placeholder="أدخل اسم المستخدم"
            className="h-11"
            dir="ltr"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">كلمة المرور</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="أدخل كلمة المرور"
            className="h-11"
            dir="ltr"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 text-center">
          {error}
        </div>
      )}

      {/* Submit */}
      <Button type="submit" className="w-full h-11 text-base font-bold" disabled={loading}>
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
