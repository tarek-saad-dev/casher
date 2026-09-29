'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import ShiftCloseReconPanel from '@/components/treasury/ShiftCloseReconPanel';
import { useSession } from '@/hooks/useSession';
import { Clock, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ShiftClosePage() {
  const router = useRouter();
  const { shift, hasOpenShift, refresh } = useSession();
  const [showPanel, setShowPanel] = useState(false);

  async function handleClosed() {
    setShowPanel(false);
    try {
      await refresh();
    } catch {
      // best-effort
    }
    router.refresh();
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="تقفيل الوردية"
        description="مراجعة مبالغ الوردية وعدّ الخزنة ثم الإغلاق"
      >
        {hasOpenShift && shift?.ID ? (
          <Button
            className="gap-2 bg-amber-600 hover:bg-amber-700"
            onClick={() => setShowPanel(true)}
          >
            <Lock className="w-4 h-4" />
            تقفيل الوردية
          </Button>
        ) : null}
      </PageHeader>

      {hasOpenShift && shift?.ID ? (
        <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 p-6 space-y-3">
          <p className="text-white font-medium">
            وردية مفتوحة: {shift.ShiftName || '—'}
          </p>
          <p className="text-sm text-zinc-400">
            راجع المبالغ الفعلية لكل طريقة دفع ثم اقفل الوردية. الفرق مسموح والملاحظة اختيارية.
          </p>
          <Button
            className="gap-2 bg-amber-600 hover:bg-amber-700"
            onClick={() => setShowPanel(true)}
          >
            <Lock className="w-4 h-4" />
            بدء تقفيل الوردية
          </Button>
        </div>
      ) : (
        <EmptyState
          title="لا توجد وردية مفتوحة"
          description="افتح وردية أولاً ثم عد لتقفيلها من هنا أو من تسجيل الخروج."
          icon={<Clock className="w-8 h-8 text-amber-500" />}
        />
      )}

      {showPanel && shift?.ID ? (
        <ShiftCloseReconPanel
          shiftMoveId={shift.ID}
          shiftName={shift.ShiftName}
          onClose={() => setShowPanel(false)}
          onClosed={() => void handleClosed()}
        />
      ) : null}
    </div>
  );
}
