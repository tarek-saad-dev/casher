'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Loader2, Save, AlertTriangle } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type BranchOpt = {
  branchId: number;
  branchCode: string;
  branchName: string;
  lifecycleStatus: string;
  isActive: boolean;
  isAssigned?: boolean;
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
  conflict?: string | null;
};

const BRANCH_BADGE: Record<string, string> = {
  GLEEM: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
  CAMP_CAESAR: 'bg-sky-500/15 text-sky-200 border-sky-500/40',
};

function branchBadgeClass(code: string) {
  return BRANCH_BADGE[code] ?? 'bg-muted text-muted-foreground border-border';
}

export default function EmployeeBranchSchedulePage() {
  const params = useParams<{ empId: string }>();
  const empId = params.empId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employee, setEmployee] = useState<{ empName: string; isActive: boolean } | null>(null);
  const [branches, setBranches] = useState<BranchOpt[]>([]);
  const [hasActiveAssignment, setHasActiveAssignment] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('تحديث توزيع الفروع الأسبوعي');
  const [days, setDays] = useState<DayDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<{
    canSave: boolean;
    blockers: Array<{ code: string; message: string }>;
    warnings: string[];
    affectedBookings: Array<{ bookingId: number; bookingCode: string | null; bookingDate: string }>;
  } | null>(null);

  const load = useCallback(async () => {
    if (!empId) return;
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
      setEmployee(data.employee);
      setBranches(data.assignedBranches || []);
      setHasActiveAssignment(data.hasActiveAssignment !== false);
      const from = data.weekStart || new Date().toISOString().slice(0, 10);
      setEffectiveFrom(from);
      const drafts: DayDraft[] = (data.days || []).map(
        (d: {
          dayOfWeek: number;
          dayNameAr: string;
          globalResult: {
            branchId: number;
            startTime?: string | null;
            endTime?: string | null;
          } | null;
          isGlobalDayOff: boolean;
          conflict: { code: string } | null;
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
            conflict: d.conflict?.code ?? null,
          };
        },
      );
      setDays(drafts);
      setDirty(false);
      setPreview(null);
    } catch {
      setError('فشل الاتصال');
    } finally {
      setLoading(false);
    }
  }, [empId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const updateDay = (dow: number, patch: Partial<DayDraft>) => {
    setDays((prev) => prev.map((d) => (d.dayOfWeek === dow ? { ...d, ...patch } : d)));
    setDirty(true);
    setPreview(null);
  };

  const summary = useMemo(() => {
    return days.map((d) => {
      if (d.status === 'off' || !d.branchId) {
        return { ...d, label: 'إجازة', code: null as string | null };
      }
      const b = branches.find((x) => x.branchId === d.branchId);
      return { ...d, label: b?.branchName ?? 'فرع', code: b?.branchCode ?? null };
    });
  }, [days, branches]);

  const payloadDays = () =>
    days.map((d) => ({
      dayOfWeek: d.dayOfWeek,
      status: d.status,
      branchId: d.status === 'working' ? d.branchId : null,
      useBranchHours: d.useBranchHours,
      startTime: d.useBranchHours ? null : d.startTime || null,
      endTime: d.useBranchHours ? null : d.endTime || null,
      canReceiveBookings: d.canReceiveBookings,
    }));

  async function runPreview() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/employees/${empId}/branch-schedule/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ effectiveFrom, days: payloadDays(), reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'فشل المعاينة');
        return;
      }
      setPreview(data.preview);
    } catch {
      setError('فشل المعاينة');
    } finally {
      setSaving(false);
    }
  }

  async function runSave(allowAffectingBookings = false) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/employees/${empId}/branch-schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          effectiveFrom,
          days: payloadDays(),
          reason,
          allowAffectingBookings,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'فشل الحفظ');
        if (data.details?.blockers) {
          setPreview({
            canSave: false,
            blockers: data.details.blockers,
            warnings: [],
            affectedBookings: data.details.affectedBookings || [],
          });
        }
        return;
      }
      setDirty(false);
      setPreview(data.preview ?? null);
      await load();
    } catch {
      setError('فشل الحفظ');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground" dir="rtl">
        <Loader2 className="h-5 w-5 animate-spin" />
        جاري التحميل…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6" dir="rtl">
      <Link
        href="/admin/hr?tab=employees"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowRight className="h-4 w-4" />
        الموظفون
      </Link>

      <PageHeader
        title="مواعيد وفروع الموظف"
        description={employee?.empName ?? `EmpID ${empId}`}
      >
        <Badge variant={employee?.isActive ? 'default' : 'outline'}>
          الحالة: {employee?.isActive ? 'نشط' : 'موقوف'}
        </Badge>
      </PageHeader>

      {!hasActiveAssignment && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          الموظف ده لسه متعيّنش على أي فرع. تقدر تختار الفرع من القائمة تحت وتحفظ الجدول —
          هيتعمل له تعيين تلقائي مع خطة الراتب من بيانات الموظف إن وجدت.
        </div>
      )}

      <div className="mb-4 rounded-xl border border-border bg-surface p-4">
        <p className="mb-3 text-sm font-semibold">الملخص العام (من نفس المحلّل)</p>
        <div className="flex flex-wrap gap-2">
          {summary.map((s) => (
            <span
              key={s.dayOfWeek}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs',
                s.code ? branchBadgeClass(s.code) : 'border-border text-muted-foreground',
              )}
            >
              <span className="opacity-80">{s.dayNameAr}:</span>
              <strong>{s.label}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>تاريخ بدء الجدول</Label>
          <Input
            type="date"
            value={effectiveFrom}
            onChange={(e) => {
              setEffectiveFrom(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label>سبب التعديل</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>

      {dirty && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          توجد تغييرات غير محفوظة
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {days.map((day) => {
          const branch = branches.find((b) => b.branchId === day.branchId);
          const hoursLabel =
            day.status === 'working' && day.useBranchHours && branch
              ? `${branch.defaultOpenTime ?? '—'} → ${branch.defaultCloseTime ?? '—'}${
                  branch.defaultOpenTime &&
                  branch.defaultCloseTime &&
                  branch.defaultCloseTime <= branch.defaultOpenTime
                    ? ' +1'
                    : ''
                }`
              : day.status === 'working'
                ? `${day.startTime || '—'} → ${day.endTime || '—'}`
                : '—';

          return (
            <div
              key={day.dayOfWeek}
              className="rounded-2xl border border-border bg-surface p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{day.dayNameAr}</h3>
                {day.conflict && (
                  <span className="inline-flex items-center gap-1 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    هذا اليوم يتعارض مع جدول فرع آخر ({day.conflict})
                  </span>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">الفرع التشغيلي</span>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                    value={day.status === 'off' ? 'off' : String(day.branchId ?? '')}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'off') {
                        updateDay(day.dayOfWeek, {
                          status: 'off',
                          branchId: null,
                        });
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
                        {!b.isAssigned ? ' (غير معيّن بعد)' : ''}
                        {!b.isActive || b.lifecycleStatus === 'SETUP' ? ' (إعداد)' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">الساعات</span>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                    disabled={day.status !== 'working'}
                    value={day.useBranchHours ? 'branch' : 'custom'}
                    onChange={(e) =>
                      updateDay(day.dayOfWeek, {
                        useBranchHours: e.target.value === 'branch',
                      })
                    }
                  >
                    <option value="branch">استخدام ساعات الفرع</option>
                    <option value="custom">وقت مخصص</option>
                  </select>
                  <p className="text-[11px] text-muted-foreground">{hoursLabel}</p>
                </label>

                {!day.useBranchHours && day.status === 'working' && (
                  <>
                    <label className="text-sm space-y-1">
                      <span className="text-muted-foreground">من</span>
                      <Input
                        type="time"
                        value={day.startTime}
                        onChange={(e) =>
                          updateDay(day.dayOfWeek, { startTime: e.target.value })
                        }
                      />
                    </label>
                    <label className="text-sm space-y-1">
                      <span className="text-muted-foreground">إلى</span>
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

                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">الحجز</span>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                    disabled={day.status !== 'working'}
                    value={day.canReceiveBookings ? 'book' : 'internal'}
                    onChange={(e) =>
                      updateDay(day.dayOfWeek, {
                        canReceiveBookings: e.target.value === 'book',
                      })
                    }
                  >
                    <option value="book">يستقبل حجوزات</option>
                    <option value="internal">تشغيل داخلي فقط</option>
                  </select>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {preview && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-4 space-y-2">
          <h3 className="font-semibold">معاينة تأثير الجدول</h3>
          {preview.blockers.map((b) => (
            <p key={b.code} className="text-sm text-destructive">
              {b.message} <span className="opacity-70">({b.code})</span>
            </p>
          ))}
          {preview.warnings.map((w) => (
            <p key={w} className="text-sm text-amber-200">
              {w}
            </p>
          ))}
          {preview.affectedBookings.length > 0 && (
            <div className="text-sm">
              <p className="mb-1 font-medium">حجوزات متأثرة (لن تُنقل تلقائياً):</p>
              <ul className="list-disc pr-5 text-muted-foreground">
                {preview.affectedBookings.slice(0, 10).map((b) => (
                  <li key={b.bookingId}>
                    {b.bookingCode || b.bookingId} — {b.bookingDate}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setPreview(null)}>
                  إلغاء تعديل الجدول
                </Button>
                <Link
                  href="/bookings"
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                >
                  فتح الحجوزات المتأثرة
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={saving} onClick={() => void runPreview()}>
          معاينة
        </Button>
        <Button
          type="button"
          disabled={saving || !dirty}
          onClick={() => void runSave(false)}
        >
          {saving ? <Loader2 className="ml-1.5 h-4 w-4 animate-spin" /> : <Save className="ml-1.5 h-4 w-4" />}
          حفظ الجدول
        </Button>
      </div>
    </div>
  );
}
