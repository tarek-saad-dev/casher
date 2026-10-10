'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Banknote, CalendarCheck2, CheckCircle2, Circle, CreditCard,
  Loader2, RefreshCw, ShieldCheck, WalletCards, AlertTriangle, LockKeyhole,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getOperationalDate } from '@/lib/businessDate';
import { hrBranchLabel } from '@/lib/hr/legacyHrBranchPolicy';

type BranchStatus = {
  branchId: number;
  branchCode: string;
  branchName: string;
  treasury: {
    closed: boolean;
    reconciliationCount: number;
    closedAt: string | null;
  };
  paymentReview: {
    completed: boolean;
    completedAt: string | null;
    completedByUserId: number | null;
  };
  attendance: {
    complete: boolean;
    pendingCount: number;
    pending: Array<{
      code: string;
      empId: number | null;
      empName: string | null;
      message: string;
    }>;
  };
  payroll: {
    generated: boolean;
    closed: boolean;
    payrollRowCount: number;
    blockerCount: number;
    totalWage: number;
    persistedState: string;
    recommendedState: string;
    readyToClose: boolean;
  };
};

type ClosingStatus = {
  workDate: string;
  branches: BranchStatus[];
  steps: {
    treasury: { complete: boolean };
    paymentReview: { complete: boolean };
    attendance: { complete: boolean; pendingCount: number };
    payroll: { complete: boolean; generatedCount: number };
  };
  complete: boolean;
};

function branchLabel(code: string, name: string) {
  return hrBranchLabel({ branchCode: code, branchName: name });
}

export default function ManagerClosingPage() {
  const router = useRouter();
  const [workDate, setWorkDate] = useState(getOperationalDate());
  const [data, setData] = useState<ClosingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyBranch, setBusyBranch] = useState<number | null>(null);
  const [markingReview, setMarkingReview] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/admin/manager-closing/status?workDate=${encodeURIComponent(workDate)}`,
        { cache: 'no-store' },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'تعذر تحميل حالة التقفيل');
      setData(body);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل حالة التقفيل');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [workDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const switchBranchAndGo = async (branch: BranchStatus, target: string) => {
    setBusyBranch(branch.branchId);
    setError('');
    try {
      const res = await fetch('/api/auth/switch-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: branch.branchId }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.message || body.error || 'تعذر تبديل الفرع');
      }
      router.push(target);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'تعذر تبديل الفرع');
      setBusyBranch(null);
    }
  };

  const completePaymentReview = async (branch: BranchStatus) => {
    setMarkingReview(branch.branchId);
    setError('');
    try {
      const res = await fetch('/api/admin/manager-closing/payment-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: branch.branchId,
          workDate,
          notes: 'مراجعة طرق الدفع من Manager Closing Flow',
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'تعذر حفظ المراجعة');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'تعذر حفظ المراجعة');
    } finally {
      setMarkingReview(null);
    }
  };

  const stepItems = useMemo(() => {
    if (!data) return [];
    return [
      {
        no: 1,
        title: 'تقفيل الخزنة',
        subtitle: 'قفل الفلوس للفرعين بالترتيب',
        complete: data.steps.treasury.complete,
        icon: Banknote,
      },
      {
        no: 2,
        title: 'مراجعة طرق الدفع',
        subtitle: 'مراجعة أي تحويلات بين Cash / Visa / InstaPay وغيرها',
        complete: data.steps.paymentReview.complete,
        icon: CreditCard,
      },
      {
        no: 3,
        title: 'تقفيل الحضور',
        subtitle: data.steps.attendance.complete
          ? 'كل حضور الموظفين مكتمل'
          : `${data.steps.attendance.pendingCount} حالة لسه محتاجة تقفيل`,
        complete: data.steps.attendance.complete,
        icon: CalendarCheck2,
      },
      {
        no: 4,
        title: 'توليد اليوميات',
        subtitle: data.steps.payroll.complete
          ? 'اليوميات متولدة'
          : 'آخر خطوة بعد اكتمال الحضور',
        complete: data.steps.payroll.complete,
        icon: WalletCards,
      },
    ];
  }, [data]);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6" dir="rtl">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface/60 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-primary">
              <ShieldCheck className="h-4 w-4" />
              Manager Closing
            </div>
            <h1 className="text-2xl font-bold text-foreground">تقفيل المدير</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              امشِ على الأربع خطوات بالترتيب، والسيستم يقولك إيه اللي خلص وإيه اللي ناقص.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className="w-[170px]"
            />
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`ml-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              تحديث
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center rounded-2xl border border-border py-20">
            <Loader2 className="ml-2 h-6 w-6 animate-spin text-primary" />
            جاري تحميل حالة اليوم...
          </div>
        ) : data ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              {stepItems.map((step) => {
                const Icon = step.icon;
                return (
                  <div
                    key={step.no}
                    className={`rounded-xl border p-4 ${step.complete
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-border bg-surface/50'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-sm font-bold">
                        {step.no}
                      </div>
                      {step.complete ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <h2 className="font-semibold">{step.title}</h2>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.subtitle}</p>
                  </div>
                );
              })}
            </div>

            {data.complete && (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
                <div>
                  <div className="font-bold">اليوم مقفول بالكامل</div>
                  <div className="text-xs opacity-80">{workDate}</div>
                </div>
              </div>
            )}

            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-bold">1. تقفيل الخزنة</h2>
                {data.branches.length > 1 && (
                  <p className="text-sm text-muted-foreground">
                    {`ابدأ ب${data.branches.map((b) => branchLabel(b.branchCode, b.branchName)).join(' ثم ')}.`}
                  </p>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {data.branches.map((branch, index) => (
                  <div key={branch.branchId} className="rounded-xl border border-border bg-surface/40 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground">الفرع {index + 1}</div>
                        <div className="font-bold">{branchLabel(branch.branchCode, branch.branchName)}</div>
                      </div>
                      {branch.treasury.closed ? (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400">مقفول ✓</span>
                      ) : (
                        <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-400">لسه</span>
                      )}
                    </div>
                    <Button
                      className="mt-4 w-full"
                      variant={branch.treasury.closed ? 'outline' : 'default'}
                      disabled={busyBranch === branch.branchId}
                      onClick={() => void switchBranchAndGo(
                        branch,
                        `/treasury/daily?managerClosing=1&date=${encodeURIComponent(workDate)}`,
                      )}
                    >
                      {busyBranch === branch.branchId ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <ArrowLeft className="ml-2 h-4 w-4" />}
                      {branch.treasury.closed ? 'مراجعة الخزنة' : 'فتح وتقفيل الخزنة'}
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-bold">2. مراجعة طرق الدفع</h2>
                <p className="text-sm text-muted-foreground">راجع التحويلات بين طرق الدفع ثم علّم الفرع كمُراجع.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {data.branches.map((branch) => (
                  <div key={branch.branchId} className="rounded-xl border border-border bg-surface/40 p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-bold">{branchLabel(branch.branchCode, branch.branchName)}</div>
                      {branch.paymentReview.completed ? (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400">تمت المراجعة ✓</span>
                      ) : (
                        <span className="rounded-full bg-zinc-500/10 px-2 py-1 text-xs text-muted-foreground">غير مُراجع</span>
                      )}
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        disabled={busyBranch === branch.branchId}
                        onClick={() => void switchBranchAndGo(
                          branch,
                          `/treasury/period-summary?managerClosing=1&date=${encodeURIComponent(workDate)}`,
                        )}
                      >
                        <ArrowLeft className="ml-2 h-4 w-4" />
                        فتح الملخص
                      </Button>
                      <Button
                        variant={branch.paymentReview.completed ? 'outline' : 'default'}
                        disabled={markingReview === branch.branchId}
                        onClick={() => void completePaymentReview(branch)}
                      >
                        {markingReview === branch.branchId ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="ml-2 h-4 w-4" />}
                        تمت المراجعة
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-surface/40 p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-bold">3. تقفيل الحضور</h2>
                  <p className="text-sm text-muted-foreground">
                    {data.steps.attendance.complete
                      ? 'كل حالات الحضور مكتملة.'
                      : `متبقي ${data.steps.attendance.pendingCount} حالة تحتاج تدخل.`}
                  </p>
                  {!data.steps.attendance.complete && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {data.branches.flatMap((b) => b.attendance.pending).slice(0, 8).map((item, i) => (
                        <span key={`${item.empId}-${i}`} className="rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-xs text-amber-300">
                          {item.empName || 'موظف'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  onClick={() => router.push(
                    `/admin/hr?tab=attendance&managerClosing=1&date=${encodeURIComponent(workDate)}`,
                  )}
                >
                  <CalendarCheck2 className="ml-2 h-4 w-4" />
                  {data.steps.attendance.complete ? 'مراجعة الحضور' : 'تقفيل الحالات الناقصة'}
                </Button>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-surface/40 p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-bold">4. توليد اليوميات</h2>
                  <p className="text-sm text-muted-foreground">
                    {data.steps.payroll.complete
                      ? `تم توليد ${data.steps.payroll.generatedCount} يومية.`
                      : data.steps.attendance.complete
                        ? 'الحضور جاهز — ادخل ولّد اليوميات للفرعين.'
                        : 'الأفضل تكمل الحضور الأول قبل توليد اليوميات.'}
                  </p>
                </div>
                <Button
                  variant={data.steps.attendance.complete ? 'default' : 'outline'}
                  onClick={() => router.push(
                    `/admin/hr?tab=daily-payroll&managerClosing=1&date=${encodeURIComponent(workDate)}`,
                  )}
                >
                  {data.steps.attendance.complete ? <WalletCards className="ml-2 h-4 w-4" /> : <LockKeyhole className="ml-2 h-4 w-4" />}
                  فتح اليوميات
                </Button>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
