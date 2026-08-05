'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Clock, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type BranchOpt = {
  branchId: number;
  branchCode: string;
  branchName: string;
  defaultOpenTime: string | null;
  defaultCloseTime: string | null;
};

type DayDraft = {
  dayOfWeek: number;
  dayNameAr: string;
  status: 'working' | 'off';
  branchId: number | null;
  useBranchHours: boolean;
  startTime: string;
  endTime: string;
  canReceiveBookings: boolean;
};

export function WeeklyScheduleLayerControl({
  empId,
  employeeName,
  onSaved,
}: {
  empId: number;
  employeeName: string;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchOpt[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('تحديث من لوحة التوافر');
  const [days, setDays] = useState<DayDraft[]>([]);
  const [savedHours, setSavedHours] = useState<{
    startTime: string;
    endTime: string;
  } | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/employees/${empId}/branch-schedule`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'فشل التحميل');
        return;
      }
      setBranches(data.assignedBranches || []);
      setEffectiveFrom(data.weekStart || new Date().toISOString().slice(0, 10));
      const ci = data.employee?.defaultCheckInTime?.slice?.(0, 5);
      const co = data.employee?.defaultCheckOutTime?.slice?.(0, 5);
      setSavedHours(ci && co ? { startTime: ci, endTime: co } : null);
      setDays(
        (data.days || []).map(
          (d: {
            dayOfWeek: number;
            dayNameAr: string;
            globalResult: {
              branchId: number;
              startTime?: string | null;
              endTime?: string | null;
            } | null;
            isGlobalDayOff: boolean;
          }) => {
            const g = d.globalResult;
            const br = g
              ? (data.assignedBranches as BranchOpt[]).find((b) => b.branchId === g.branchId)
              : null;
            const useBranch =
              !g?.startTime ||
              !br ||
              (br.defaultOpenTime === g.startTime?.slice(0, 5) &&
                br.defaultCloseTime === g.endTime?.slice(0, 5));
            return {
              dayOfWeek: d.dayOfWeek,
              dayNameAr: d.dayNameAr,
              status: g && !d.isGlobalDayOff ? ('working' as const) : ('off' as const),
              branchId: g?.branchId ?? null,
              useBranchHours: useBranch,
              startTime: g?.startTime?.slice(0, 5) ?? '',
              endTime: g?.endTime?.slice(0, 5) ?? '',
              canReceiveBookings: true,
            };
          },
        ),
      );
      setDirty(false);
      setHint(null);
    } catch {
      setError('فشل الاتصال');
    } finally {
      setLoading(false);
    }
  }, [empId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateDay = (dow: number, patch: Partial<DayDraft>) => {
    setDays((prev) => prev.map((d) => (d.dayOfWeek === dow ? { ...d, ...patch } : d)));
    setDirty(true);
    setHint(null);
  };

  const copyHours = (sourceDow: number) => {
    const source = days.find((d) => d.dayOfWeek === sourceDow);
    if (!source || source.status !== 'working') return;
    setDays((prev) =>
      prev.map((d) =>
        d.dayOfWeek === sourceDow || d.status !== 'working'
          ? d
          : {
              ...d,
              useBranchHours: source.useBranchHours,
              startTime: source.startTime,
              endTime: source.endTime,
            },
      ),
    );
    setDirty(true);
    setHint(`تم نسخ مواعيد ${source.dayNameAr} لباقي أيام العمل`);
  };

  const applySaved = () => {
    if (!savedHours) return;
    setDays((prev) =>
      prev.map((d) =>
        d.status !== 'working'
          ? d
          : {
              ...d,
              useBranchHours: false,
              startTime: savedHours.startTime,
              endTime: savedHours.endTime,
            },
      ),
    );
    setDirty(true);
    setHint('تم تطبيق مواعيد الموظف المحفوظة');
  };

  const payloadDays = useMemo(
    () =>
      days.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        status: d.status,
        branchId: d.status === 'working' ? d.branchId : null,
        useBranchHours: d.useBranchHours,
        startTime: d.useBranchHours ? null : d.startTime || null,
        endTime: d.useBranchHours ? null : d.endTime || null,
        canReceiveBookings: d.canReceiveBookings,
      })),
    [days],
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/employees/${empId}/branch-schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          effectiveFrom,
          days: payloadDays,
          reason,
          allowAffectingBookings: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'فشل الحفظ');
        return;
      }
      setDirty(false);
      setHint('تم حفظ الجدول الأسبوعي');
      onSaved();
      await load();
    } catch {
      setError('فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        جاري تحميل الجدول…
      </div>
    );
  }

  return (
    <div className="space-y-3" dir="rtl">
      <p className="text-xs text-zinc-400">
        تعديل الجدول الأسبوعي لـ <strong className="text-zinc-200">{employeeName}</strong>. التغيير
        يؤثر على نفس اليوم من كل أسبوع.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs space-y-1">
          <span className="text-zinc-500">تاريخ بدء السريان</span>
          <Input
            type="date"
            value={effectiveFrom}
            onChange={(e) => {
              setEffectiveFrom(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-zinc-500">سبب التعديل</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>

      {savedHours && (
        <Button type="button" size="sm" variant="outline" onClick={applySaved}>
          <Clock className="ml-1 h-3.5 w-3.5" />
          مواعيد الموظف ({savedHours.startTime}→{savedHours.endTime})
        </Button>
      )}

      {hint && (
        <p className="text-[11px] text-emerald-200 bg-emerald-950/30 border border-emerald-500/30 rounded px-2 py-1">
          {hint}
        </p>
      )}
      {error && (
        <p className="text-[11px] text-rose-300 bg-rose-950/30 border border-rose-500/30 rounded px-2 py-1">
          {error}
        </p>
      )}

      <div className="max-h-[50vh] overflow-y-auto space-y-2 pr-0.5">
        {days.map((day) => (
          <div
            key={day.dayOfWeek}
            className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-2.5 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-100">{day.dayNameAr}</span>
              {day.status === 'working' && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[10px]"
                  onClick={() => copyHours(day.dayOfWeek)}
                >
                  <Copy className="ml-1 h-3 w-3" />
                  نسخ لباقي الأيام
                </Button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] space-y-1">
                <span className="text-zinc-500">الفرع</span>
                <select
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
                  value={day.status === 'off' ? 'off' : String(day.branchId ?? '')}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'off') {
                      updateDay(day.dayOfWeek, { status: 'off', branchId: null });
                    } else {
                      updateDay(day.dayOfWeek, {
                        status: 'working',
                        branchId: Number(v),
                        useBranchHours: true,
                      });
                    }
                  }}
                >
                  <option value="off">إجازة</option>
                  {branches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.branchName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] space-y-1">
                <span className="text-zinc-500">الساعات</span>
                <select
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
                  disabled={day.status !== 'working'}
                  value={day.useBranchHours ? 'branch' : 'custom'}
                  onChange={(e) => {
                    const useBranchHours = e.target.value === 'branch';
                    if (useBranchHours) {
                      updateDay(day.dayOfWeek, { useBranchHours: true });
                      return;
                    }
                    updateDay(day.dayOfWeek, {
                      useBranchHours: false,
                      startTime:
                        day.startTime ||
                        savedHours?.startTime ||
                        '',
                      endTime: day.endTime || savedHours?.endTime || '',
                    });
                  }}
                >
                  <option value="branch">ساعات الفرع</option>
                  <option value="custom">وقت مخصص</option>
                </select>
              </label>
              {!day.useBranchHours && day.status === 'working' && (
                <>
                  <label className="text-[11px] space-y-1">
                    <span className="text-zinc-500">من</span>
                    <Input
                      type="time"
                      value={day.startTime}
                      onChange={(e) =>
                        updateDay(day.dayOfWeek, { startTime: e.target.value })
                      }
                    />
                  </label>
                  <label className="text-[11px] space-y-1">
                    <span className="text-zinc-500">إلى</span>
                    <Input
                      type="time"
                      value={day.endTime}
                      onChange={(e) =>
                        updateDay(day.dayOfWeek, { endTime: e.target.value })
                      }
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-1 sticky bottom-0 bg-zinc-950/95 py-2">
        <Button type="button" disabled={saving || !dirty} onClick={() => void save()}>
          {saving ? (
            <Loader2 className="ml-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Save className="ml-1.5 h-4 w-4" />
          )}
          حفظ الجدول الأسبوعي
        </Button>
        <Label className="text-[10px] text-zinc-500 self-center">
          {dirty ? 'توجد تغييرات غير محفوظة' : 'لا توجد تغييرات'}
        </Label>
      </div>
    </div>
  );
}
