'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AttendanceLayerControl({
  empId,
  employeeName,
  businessDate,
  currentStatus,
  checkInTime,
  checkOutTime,
  onSaved,
}: {
  empId: number;
  employeeName: string;
  businessDate: string;
  currentStatus?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [inTime, setInTime] = useState(checkInTime?.slice(0, 5) || '13:00');
  const [outTime, setOutTime] = useState(checkOutTime?.slice(0, 5) || '');

  useEffect(() => {
    setInTime(checkInTime?.slice(0, 5) || '13:00');
    setOutTime(checkOutTime?.slice(0, 5) || '');
    setError(null);
    setHint(null);
  }, [checkInTime, checkOutTime, empId, businessDate]);

  const save = async (status: 'Present' | 'Absent') => {
    setSaving(true);
    setError(null);
    setHint(null);
    try {
      const body: Record<string, unknown> = {
        EmpID: empId,
        WorkDate: businessDate,
        Status: status,
      };
      if (status === 'Present') {
        body.CheckInTime = inTime || null;
        body.CheckOutTime = outTime || null;
      } else {
        body.CheckInTime = null;
        body.CheckOutTime = null;
      }
      const res = await fetch('/api/admin/attendance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'فشل حفظ الحضور');
        return;
      }
      setHint(status === 'Present' ? 'تم تسجيل الحضور' : 'تم تسجيل الغياب');
      onSaved();
    } catch {
      setError('تعذر الاتصال');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3" dir="rtl">
      <p className="text-xs text-zinc-400">
        حضور <strong className="text-zinc-200">{employeeName}</strong> لتاريخ{' '}
        <span className="font-mono">{businessDate}</span>
      </p>
      <p className="text-[11px] text-zinc-500">
        الحالة الحالية: {currentStatus || '—'}
        {checkInTime ? ` · دخول ${checkInTime}` : ''}
        {checkOutTime ? ` · خروج ${checkOutTime}` : ''}
      </p>
      <p className="text-[11px] text-amber-200/80 rounded border border-amber-500/30 bg-amber-950/20 px-2 py-1.5">
        الحضور لا يفتح الحجوزات بمفرده — لازم تكون فيه نوافذ عمل من الجدول أو التعديل اليومي.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] space-y-1">
          <span className="text-zinc-500">وقت الدخول</span>
          <Input type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} />
        </label>
        <label className="text-[11px] space-y-1">
          <span className="text-zinc-500">وقت الخروج (اختياري)</span>
          <Input type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} />
        </label>
      </div>

      {hint && <p className="text-[11px] text-emerald-200">{hint}</p>}
      {error && <p className="text-[11px] text-rose-300">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={saving}
          onClick={() => void save('Present')}
        >
          {saving ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : null}
          تسجيل حضور
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => void save('Absent')}
        >
          تسجيل غياب
        </Button>
      </div>
    </div>
  );
}
