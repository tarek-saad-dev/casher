'use client';

import { useSession } from '@/hooks/useSession';
import { AlertTriangle, CalendarDays, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export default function ShiftRequiredOverlay() {
  const { hasActiveDay, hasActiveShift, loading, isAuthenticated } = useSession();
  const router = useRouter();

  if (loading || !isAuthenticated) return null;
  if (hasActiveDay && hasActiveShift) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 text-center max-w-md p-8">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10">
          <AlertTriangle className="w-8 h-8 text-destructive" />
        </div>

        <h2 className="text-xl font-bold">لا يمكن إنشاء فواتير</h2>

        <div className="space-y-2 text-sm text-muted-foreground">
          {!hasActiveDay && (
            <div className="flex items-center gap-2 justify-center text-destructive">
              <CalendarDays className="w-4 h-4" />
              <span>لا يوجد يوم عمل مفتوح</span>
            </div>
          )}
          {hasActiveDay && !hasActiveShift && (
            <div className="flex items-center gap-2 justify-center text-destructive">
              <Clock className="w-4 h-4" />
              <span>لا يوجد وردية مفتوحة</span>
            </div>
          )}
          <p className="mt-2">
            يجب فتح يوم عمل ووردية قبل البدء في البيع.
          </p>
        </div>

        <div className="flex gap-2 mt-2">
          {!hasActiveDay && (
            <Button onClick={() => router.push('/admin/day')}>
              <CalendarDays className="w-4 h-4 ml-2" />
              إدارة اليوم
            </Button>
          )}
          {hasActiveDay && !hasActiveShift && (
            <Button onClick={() => router.push('/admin/shift')}>
              <Clock className="w-4 h-4 ml-2" />
              إدارة الورديات
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
