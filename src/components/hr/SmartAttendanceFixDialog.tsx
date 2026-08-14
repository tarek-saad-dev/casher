'use client';

/**
 * Thin attendance editor for Smart Fix — reuses PUT /api/admin/attendance
 * (same API as AttendancePanel). Not a duplicate attendance board.
 */

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface SmartAttendanceFixDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: number;
  workDate: string;
  empId: number;
  empName: string;
  /** Ensures session branch matches before GET/PUT. */
  ensureSessionBranch: (branchId: number) => Promise<boolean>;
  onSaved: () => void;
}

export default function SmartAttendanceFixDialog({
  open,
  onOpenChange,
  branchId,
  workDate,
  empId,
  empName,
  ensureSessionBranch,
  onSaved,
}: SmartAttendanceFixDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [status, setStatus] = useState('Present');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError('');
      try {
        const ok = await ensureSessionBranch(branchId);
        if (!ok) {
          if (!cancelled) setError('تعذر تبديل الفرع لتعديل الحضور');
          return;
        }
        const res = await fetch(
          `/api/admin/attendance?date=${encodeURIComponent(workDate)}&onlyPayrollEnabled=true`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل تحميل الحضور');
        const row = (data.attendance ?? []).find(
          (r: { EmpID: number }) => Number(r.EmpID) === empId,
        );
        if (cancelled) return;
        setCheckIn(row?.CheckInTime ? String(row.CheckInTime).slice(0, 5) : '');
        setCheckOut(row?.CheckOutTime ? String(row.CheckOutTime).slice(0, 5) : '');
        setStatus(row?.Status || 'Present');
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'خطأ في التحميل');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, branchId, workDate, empId, ensureSessionBranch]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const ok = await ensureSessionBranch(branchId);
      if (!ok) throw new Error('تعذر تبديل الفرع');
      const res = await fetch('/api/admin/attendance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          EmpID: empId,
          WorkDate: workDate,
          CheckInTime: checkIn || null,
          CheckOutTime: checkOut || null,
          Status: status || 'Present',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.code || 'تعذر حفظ الحضور');
      }
      onOpenChange(false);
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>تعديل حضور — {empName}</DialogTitle>
          <DialogDescription className="text-zinc-400 text-sm">
            الفرع #{branchId} · {workDate} — يستخدم نفس واجهة حفظ الحضور الحالية
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center gap-2 text-zinc-400 py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل…
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs text-zinc-400">
                حضور
                <Input
                  type="time"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                  className="bg-zinc-800 border-zinc-600 text-white"
                />
              </label>
              <label className="space-y-1 text-xs text-zinc-400">
                انصراف
                <Input
                  type="time"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className="bg-zinc-800 border-zinc-600 text-white"
                />
              </label>
            </div>
            <label className="space-y-1 text-xs text-zinc-400 block">
              الحالة
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full h-9 rounded-md bg-zinc-800 border border-zinc-600 text-white text-sm px-2"
              >
                {['Present', 'Late', 'EarlyLeave', 'Absent', 'DayOff', 'Pending', 'Excused'].map(
                  (s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
        )}
        <DialogFooter className="gap-2 flex-row-reverse" dir="rtl">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-zinc-700 text-zinc-300"
          >
            إلغاء
          </Button>
          <Button onClick={() => void save()} disabled={saving || loading} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            حفظ الحضور
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
