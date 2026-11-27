'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  Banknote,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Crown,
  Landmark,
  Loader2,
  MessageCircle,
  MinusCircle,
  Moon,
  Lock,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import type {
  FullDayGroupedMoneyLine,
  FullDayMonthToDate,
  FullDayPaymentMix,
} from '@/lib/reports/full-day-report.types';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { FullDayReport } from '@/lib/reports/full-day-report.types';
import {
  formatCurrencyAr,
  formatDurationAr,
  formatTime12hAr,
} from '@/lib/reports/reportFormatters';

function getCairoTodayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function shiftDate(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hoursLabel(hours: number | null | undefined): string {
  if (hours == null) return '—';
  return formatDurationAr(Math.round(hours * 60));
}

export default function FullDayReportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [date, setDate] = useState(searchParams.get('date') || getCairoTodayStr());
  const [report, setReport] = useState<FullDayReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [waLog, setWaLog] = useState<string[]>([]);
  const [waError, setWaError] = useState<string | null>(null);
  const [waSuccess, setWaSuccess] = useState<string | null>(null);
  const [ownerPreviewOpen, setOwnerPreviewOpen] = useState(false);
  const [ownerPreview, setOwnerPreview] = useState<{
    ownerName: string;
    message: string;
    meta: string;
    canSend: boolean;
  } | null>(null);
  const [employeePickOpen, setEmployeePickOpen] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState<string>('');
  const [targetDetailsEmpId, setTargetDetailsEmpId] = useState<number | null>(null);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<{
    roleLabel: string;
    rows: Array<{
      empId: number;
      name: string;
      role: string | null;
      phone: string | null;
      hasPhone: boolean;
      isPrimary: boolean;
    }>;
  } | null>(null);

  const syncUrl = useCallback(
    (d: string) => {
      const params = new URLSearchParams();
      params.set('date', d);
      router.replace(`/admin/reports/full-day?${params.toString()}`, { scroll: false });
    },
    [router],
  );

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/full-day?date=${encodeURIComponent(d)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل التقرير');
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : 'خطأ غير معروف');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const urlDate = searchParams.get('date') || getCairoTodayStr();
    setDate(urlDate);
    void load(urlDate);
  }, [searchParams, load]);

  const applyDate = (d: string) => {
    setDate(d);
    syncUrl(d);
    void load(d);
  };

  const applyEmployeeWhatsAppResponse = (
    res: Response,
    data: {
      error?: string;
      results?: Array<{
        empName?: string;
        status?: string;
        reasonAr?: string;
        reason?: string;
      }>;
      summary?: { sent?: number; skipped?: number; failed?: number };
    },
    opts?: { singleName?: string },
  ) => {
    const lines: string[] = [];
    if (Array.isArray(data.results)) {
      for (const r of data.results) {
        if (r.status === 'sent') lines.push(`✓ ${r.empName}`);
        else if (r.status === 'skipped')
          lines.push(`↷ ${r.empName}: ${r.reasonAr || r.reason || 'تخطي'}`);
        else lines.push(`✗ ${r.empName}: ${r.reasonAr || r.reason || 'فشل'}`);
      }
    }
    setWaLog(lines);

    const { sent = 0, skipped = 0, failed = 0 } = data.summary ?? {};
    if (!res.ok || sent === 0) {
      setWaError(
        [data.error || 'مفيش رسائل اتبعتت', `إرسال ${sent} · تخطي ${skipped} · فشل ${failed}`]
          .filter(Boolean)
          .join(' — '),
      );
      return;
    }

    if (opts?.singleName) {
      setWaSuccess(`تم إرسال التقرير إلى ${opts.singleName}`);
    } else {
      setWaSuccess(`تم إرسال ${sent} رسالة بالدور${skipped ? ` (تخطي ${skipped})` : ''}`);
    }
  };

  const sendWhatsAppSequential = async () => {
    if (!report) return;
    if (
      !window.confirm(
        `إرسال تقرير يوم ${report.workDate} لكل الموظفين الجاهزين بالدور؟`,
      )
    ) {
      return;
    }

    setWaBusy(true);
    setWaError(null);
    setWaSuccess(null);
    setWaLog(['جاري التحضير...']);

    try {
      const res = await fetch('/api/admin/hr/employee-daily-whatsapp-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDate: report.workDate }),
      });
      const data = await res.json();
      applyEmployeeWhatsAppResponse(res, data);
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'خطأ في الإرسال');
    } finally {
      setWaBusy(false);
    }
  };

  const sendWhatsAppToEmployee = async (empId: number, empName: string) => {
    if (!report) return;
    if (
      !window.confirm(
        `إرسال تقرير يوم ${report.workDate} إلى ${empName} فقط؟`,
      )
    ) {
      return;
    }

    setWaBusy(true);
    setWaError(null);
    setWaSuccess(null);
    setWaLog([`جاري الإرسال إلى ${empName}...`]);
    setEmployeePickOpen(false);

    try {
      const res = await fetch('/api/admin/hr/employee-daily-whatsapp-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDate: report.workDate, employeeId: empId }),
      });
      const data = await res.json();
      applyEmployeeWhatsAppResponse(res, data, { singleName: empName });
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'خطأ في الإرسال');
    } finally {
      setWaBusy(false);
    }
  };

  const openEmployeePick = () => {
    if (!report) return;
    const ready = report.payroll.employees.filter((e) => e.hasPhone);
    setSelectedEmpId(ready[0] ? String(ready[0].empId) : '');
    setEmployeePickOpen(true);
  };

  const openRecipients = async () => {
    setRecipientsOpen(true);
    setRecipientsLoading(true);
    setRecipientsError(null);
    try {
      const res = await fetch('/api/admin/reports/full-day/report-recipients');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل قائمة المستلمين');
      setRecipients({
        roleLabel: String(data.roleLabel ?? 'مدير'),
        rows: Array.isArray(data.recipients) ? data.recipients : [],
      });
    } catch (err) {
      setRecipients(null);
      setRecipientsError(err instanceof Error ? err.message : 'خطأ غير معروف');
    } finally {
      setRecipientsLoading(false);
    }
  };

  const previewOwnerWhatsApp = async () => {
    if (!report) return;
    setWaBusy(true);
    setWaError(null);
    setWaSuccess(null);
    try {
      const res = await fetch(
        `/api/admin/reports/full-day/owner-whatsapp?date=${encodeURIComponent(report.workDate)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل معاينة رسالة المالك');
      setOwnerPreview({
        ownerName: String(data.ownerName ?? 'المدير'),
        message: String(data.message ?? ''),
        meta: [
          data.ownerName || 'المدير',
          data.phone ? `واتساب: ${data.phone}` : 'بدون رقم',
          data.ready ? 'جاهز للإرسال' : data.skipReason || 'غير جاهز',
        ].join(' · '),
        canSend: Boolean(data.ready && data.phone),
      });
      setOwnerPreviewOpen(true);
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'خطأ في المعاينة');
    } finally {
      setWaBusy(false);
    }
  };

  const sendOwnerWhatsApp = async () => {
    if (!report) return;
    const ownerLabel = ownerPreview?.ownerName || 'المدير';
    if (
      !window.confirm(
        `إرسال تقرير المالك ليوم ${report.workDate} إلى ${ownerLabel}؟\n(رسالة منفصلة لكل فرع نشط)`,
      )
    ) {
      return;
    }
    setWaBusy(true);
    setWaError(null);
    setWaSuccess(null);
    setOwnerPreviewOpen(false);
    try {
      const res = await fetch('/api/admin/reports/full-day/owner-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: report.workDate }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(
          data.reasonAr || data.error || data.reason || 'فشل إرسال تقرير المالك',
        );
      }
      const branchCount = Array.isArray(data.messages) ? data.messages.length : 0;
      const branchNames = Array.isArray(data.messages)
        ? data.messages
            .map((m: { branchName?: string }) => m.branchName)
            .filter(Boolean)
            .join(' + ')
        : '';
      setWaSuccess(
        branchCount > 1
          ? `تم إرسال ${branchCount} رسائل للمالك (${branchNames || 'كل الفروع'})`
          : `تم إرسال تقرير المالك إلى ${data.ownerName || 'طارق'}`,
      );
      setWaLog(
        Array.isArray(data.messages) && data.messages.length > 0
          ? data.messages.map(
              (m: { branchName?: string; branchCode?: string; status?: string }) =>
                `✓ ${m.branchName || m.branchCode || 'فرع'}: ${m.status || 'sent'}`,
            )
          : [`✓ المالك: ${data.ownerName || 'طارق'} (${data.phone || '—'})`],
      );
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'خطأ في إرسال المالك');
    } finally {
      setWaBusy(false);
    }
  };

  const runNightlyCloseNow = async (dryRun: boolean) => {
    // Resolve Cairo-yesterday at the exact click moment (same as cron), so we don't
    // wait for 02:40 — optional override = the date currently open on this page.
    const cairoToday = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Africa/Cairo',
    });
    const [y, m, d] = cairoToday.split('-').map(Number);
    const yesterdayUtc = new Date(Date.UTC(y, m - 1, d));
    yesterdayUtc.setUTCDate(yesterdayUtc.getUTCDate() - 1);
    const closeAtClickWorkDate = yesterdayUtc.toISOString().slice(0, 10);
    const workDate = report?.workDate || closeAtClickWorkDate;

    const mode = dryRun ? 'معاينة بدون تنفيذ' : 'قفل اليوم الآن — تنفيذ كامل';
    if (
      !window.confirm(
        `${mode}\nيوم العمل: ${workDate}\n` +
          (dryRun
            ? 'هيعرض مين حضوره ناقص وهيتملى من الـ Default (D) من غير حفظ.'
            : 'هيشتغل فورًا من غير انتظار الكرون: يكمل الحضور → يوميات → تارجت → واتساب موظفين + المدير (رسالة لكل فرع).'),
      )
    ) {
      return;
    }
    setWaBusy(true);
    setWaError(null);
    setWaSuccess(null);
    try {
      const res = await fetch('/api/admin/hr/nightly-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDate, dryRun }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(
          data.error ||
            (Array.isArray(data.errors) ? data.errors[0] : null) ||
            'فشل قفل اليوم',
        );
      }
      const closed = data.steps?.attendanceClose?.closed?.length ?? 0;
      const empSent = data.delivery?.employeesSent ?? 0;
      const ownerOk = data.delivery?.ownerSent ? '✓' : '✗';
      const ownerBranchMsgs = Array.isArray(data.steps?.ownerWhatsApp?.messages)
        ? data.steps.ownerWhatsApp.messages.length
        : Array.isArray(data.messages)
          ? data.messages.length
          : 0;
      setWaSuccess(
        dryRun
          ? `معاينة قفل ${workDate}: ${closed} هيتملاهم من Default (D) · جاهز موظفين ${data.delivery?.employeesReady ?? 0}`
          : `تم قفل اليوم ${workDate} الآن: DefaultFill(D)=${closed} · موظفين ${empSent} · مدير ${ownerOk}` +
              (ownerBranchMsgs > 1 ? ` (${ownerBranchMsgs} رسائل فروع)` : ''),
      );
      setWaLog([
        `قفل اليوم ${dryRun ? '(معاينة)' : 'الآن'} · ${data.workDate}`,
        `حضور→Default(D): ${closed}`,
        `يوميات: ${data.steps?.payroll?.status ?? '—'}`,
        `تارجت: ${data.steps?.targets?.generated ?? 0}`,
        `واتساب موظفين: ${empSent} (فشل ${data.delivery?.employeesFailed ?? 0})`,
        `واتساب مدير: ${data.steps?.ownerWhatsApp?.status ?? '—'} (${data.delivery?.ownerPhone ?? '—'})`,
      ]);
      if (!dryRun) await load(workDate);
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'خطأ في قفل اليوم');
    } finally {
      setWaBusy(false);
    }
  };

  return (
    <div className="space-y-5 pb-12 max-w-6xl mx-auto" dir="rtl">
      <PageHeader
        title="تقرير اليوم كامل"
        description="مبيعات · إيرادات · مصروفات · يوميات وتارجت · صافي اليوم — مع إرسال واتساب للموظفين"
      />

      {/* Sticky action bar */}
      <div className="sticky top-2 z-20 rounded-2xl border border-brand/30 bg-background backdrop-blur p-4 shadow-lg shadow-black/20 space-y-3">
        <div className="flex flex-wrap items-end gap-3 justify-between">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">تاريخ اليوم</label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-card border-border w-[160px]"
              />
            </div>
            <Button variant="outline" size="icon" onClick={() => applyDate(shiftDate(date, -1))} title="يوم سابق">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => applyDate(shiftDate(date, 1))} title="يوم تالي">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => applyDate(date)}
              disabled={loading}
              className="bg-primary hover:bg-primary-hover text-primary-foreground"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 ml-1" />}
              عرض
            </Button>
            <Button variant="ghost" onClick={() => applyDate(getCairoTodayStr())} className="text-muted-foreground">
              النهاردة
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <Button
              disabled={!report || waBusy || loading}
              onClick={() => void sendWhatsAppSequential()}
              className="bg-success hover:bg-success/85 text-success-foreground min-w-[180px]"
              title="إرسال تقرير اليوم لكل الموظفين الجاهزين"
            >
              {waBusy ? (
                <Loader2 className="h-4 w-4 animate-spin ml-1" />
              ) : (
                <MessageCircle className="h-4 w-4 ml-1" />
              )}
              لكل الموظفين
              {report ? ` (${report.whatsapp.readyToSend})` : ''}
            </Button>
            <Button
              disabled={!report || waBusy || loading || (report?.whatsapp.readyToSend ?? 0) === 0}
              variant="outline"
              onClick={openEmployeePick}
              className="border-success/50 text-success hover:bg-success-soft min-w-[140px]"
              title="إرسال تقرير اليوم لموظف واحد فقط"
            >
              <Users className="h-4 w-4 ml-1" />
              موظف معيّن
            </Button>
            <Button
              disabled={waBusy}
              variant="outline"
              onClick={() => void openRecipients()}
              className="border-info/40 text-info hover:bg-info-soft"
              title="مين بيستلم التقرير ودوره في النظام"
            >
              <UserCog className="h-4 w-4 ml-1" />
              مستلمو التقرير
            </Button>
            <Button
              disabled={!report || waBusy || loading}
              variant="outline"
              onClick={() => void previewOwnerWhatsApp()}
              className="border-brand/40 text-brand"
            >
              معاينة المالك
            </Button>
            <Button
              disabled={!report || waBusy || loading}
              onClick={() => void sendOwnerWhatsApp()}
              className="bg-primary hover:bg-primary-hover text-primary-foreground min-w-[160px]"
            >
              {waBusy ? (
                <Loader2 className="h-4 w-4 animate-spin ml-1" />
              ) : (
                <Crown className="h-4 w-4 ml-1" />
              )}
              إرسال للمدير
            </Button>
            <Button
              disabled={waBusy || loading}
              variant="outline"
              onClick={() => void runNightlyCloseNow(true)}
              className="border-border text-foreground"
              title="معاينة قفل اليوم بدون حفظ أو إرسال"
            >
              <Moon className="h-4 w-4 ml-1" />
              معاينة قفل اليوم
            </Button>
            <Button
              disabled={waBusy || loading}
              onClick={() => void runNightlyCloseNow(false)}
              className="bg-brand hover:bg-brand/85 text-brand-foreground min-w-[150px]"
              title="يشغّل سكربت قفل اليوم فور الضغط — من غير انتظار الكرون 02:40"
            >
              {waBusy ? (
                <Loader2 className="h-4 w-4 animate-spin ml-1" />
              ) : (
                <Lock className="h-4 w-4 ml-1" />
              )}
              قفل اليوم الآن
            </Button>
          </div>
        </div>

        {report && (
          <p className="text-xs text-muted-foreground">
            {report.workDateLabelAr}
            {report.whatsapp.missingPhone > 0 && (
              <span className="text-warning mr-2">
                · {report.whatsapp.missingPhone} بدون رقم واتساب
              </span>
            )}
          </p>
        )}

        {waError && (
          <div className="text-xs text-destructive flex items-start gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{waError}</span>
          </div>
        )}
        {waSuccess && (
          <div className="text-xs text-success flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {waSuccess}
          </div>
        )}
        {waLog.length > 0 && (
          <div className="max-h-28 overflow-y-auto rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground space-y-0.5 font-mono">
            {waLog.map((line, i) => (
              <div key={`${i}-${line}`}>{line}</div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive-soft p-4 text-destructive flex gap-2">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {loading && !report && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin ml-3" />
          جاري تجهيز تقرير اليوم...
        </div>
      )}

      {report && (
        <>
          {/* Net hero */}
          <div
            className={`relative overflow-hidden rounded-2xl border p-6 ${
              report.profit.net >= 0
                ? 'border-success/30 bg-gradient-to-l from-success-soft via-card to-card'
                : 'border-destructive/30 bg-gradient-to-l from-destructive-soft via-card to-card'
            }`}
          >
            <div className="text-xs text-muted-foreground mb-1">صافي ربح اليوم النهائي</div>
            <div
              className={`text-4xl sm:text-5xl font-bold tracking-tight ${
                report.profit.net >= 0 ? 'text-success' : 'text-destructive'
              }`}
            >
              {formatCurrencyAr(report.profit.net)}
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span>
                داخل: <strong className="text-foreground">{formatCurrencyAr(report.profit.totalIn)}</strong>
              </span>
              <span className="text-muted-foreground">−</span>
              <span>
                خارج: <strong className="text-foreground">{formatCurrencyAr(report.profit.totalOut)}</strong>
              </span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              داخل = مبيعات + إيرادات · خارج = مصروفات + أساسي الموظفين + التارجت
            </p>
          </div>

          {/* Payment method mix — الفلوس الداخلة متقسمة على طرق الدفع */}
          <PaymentMixCard mix={report.paymentMix} />

          {/* Flow cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              title="مبيعات اليوم"
              value={formatCurrencyAr(report.sales.total)}
              hint={`${report.sales.invoiceCount} فاتورة · ${report.sales.customerCount} عميل`}
              icon={<TrendingUp className="h-4 w-4" />}
              tone="gold"
            />
            <StatCard
              title="إيرادات اليوم"
              value={formatCurrencyAr(report.incomes.total)}
              hint={`${report.incomes.count} حركة`}
              icon={<Wallet className="h-4 w-4" />}
              tone="blue"
            />
            <StatCard
              title="مصروفات اليوم"
              value={formatCurrencyAr(report.expenses.total)}
              hint={`${report.expenses.count} حركة · بدون سلف`}
              icon={<TrendingDown className="h-4 w-4" />}
              tone="rose"
            />
            <StatCard
              title="تكلفة الموظفين"
              value={formatCurrencyAr(report.payroll.staffCostTotal)}
              hint={`أساسي ${formatCurrencyAr(report.payroll.wageTotal)} + تارجت ${formatCurrencyAr(report.payroll.targetTotal)}`}
              icon={<Users className="h-4 w-4" />}
              tone="amber"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MoneyList
              title="إيرادات اليوم"
              empty="مفيش إيرادات مسجّلة اليوم"
              total={report.incomes.total}
              lines={report.incomes.lines}
              accent="text-info"
            />
            <MoneyList
              title="مصروفات اليوم"
              empty="مفيش مصروفات تشغيلية اليوم"
              subtitle="بدون سلف الموظفين (السلف جزء من حساب المرتب)"
              total={report.expenses.total}
              lines={report.expenses.lines}
              accent="text-destructive"
            />
          </div>

          {/* Staff section */}
          <section className="rounded-2xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-card flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-brand" />
                  مرتبات · تارجت · مواعيد اليوم
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  حضور {report.payroll.presentCount} من {report.payroll.employeeCount} · أساسي{' '}
                  {formatCurrencyAr(report.payroll.wageTotal)} · تارجت{' '}
                  {formatCurrencyAr(report.payroll.targetTotal)}
                </p>
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> مواعيد
                </span>
                <span className="inline-flex items-center gap-1">
                  <Target className="h-3.5 w-3.5" /> تارجت
                </span>
              </div>
            </div>

            {report.payroll.employees.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                مفيش يوميات مولَّدة لهذا اليوم — ولّد من تبويب يوميات الموظفين أولاً
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-background text-muted-foreground text-xs">
                    <tr>
                      <th className="px-3 py-2.5 text-right font-medium">الموظف</th>
                      <th className="px-3 py-2.5 text-right font-medium">حضور</th>
                      <th className="px-3 py-2.5 text-right font-medium">انصراف</th>
                      <th className="px-3 py-2.5 text-right font-medium">ساعات</th>
                      <th className="px-3 py-2.5 text-right font-medium">الأساسي</th>
                      <th className="px-3 py-2.5 text-right font-medium">تارجت الشهر (حتى الآن)</th>
                      <th className="px-3 py-2.5 text-right font-medium">الإجمالي</th>
                      <th className="px-3 py-2.5 text-right font-medium">واتساب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.payroll.employees.map((e) => (
                      <tr key={e.empId} className="border-t border-border hover:bg-card">
                        <td className="px-3 py-2.5">
                          <div className="text-foreground font-medium">{e.empName}</div>
                          {e.attendanceStatus && (
                            <div className="text-[10px] text-muted-foreground">{e.attendanceStatus}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-foreground whitespace-nowrap">
                          {formatTime12hAr(e.checkIn) ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 text-foreground whitespace-nowrap">
                          {formatTime12hAr(e.checkOut) ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 text-foreground whitespace-nowrap">
                          {hoursLabel(e.actualHours)}
                        </td>
                        <td className="px-3 py-2.5 text-foreground whitespace-nowrap">
                          {formatCurrencyAr(e.baseWage)}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {(() => {
                            const mtdTarget = e.mtdTargetAmount;
                            const hasMtd = mtdTarget != null;
                            const belowTier =
                              hasMtd && mtdTarget <= 0 && (e.mtdSales == null || e.mtdSales > 0);
                            const noSales =
                              (e.mtdSales == null || e.mtdSales <= 0) && e.targetAmount <= 0;
                            return (
                              <button
                                type="button"
                                className="text-right hover:bg-surface-muted rounded-lg px-1.5 py-1 -mx-1.5 transition-colors"
                                onClick={() => setTargetDetailsEmpId(e.empId)}
                                title="عرض تفاصيل حساب التارجت"
                              >
                                {hasMtd ? (
                                  <div className="text-success font-medium">
                                    {formatCurrencyAr(mtdTarget)}
                                    <span className="text-[10px] text-muted-foreground font-normal mr-1">
                                      (حتى الآن)
                                    </span>
                                  </div>
                                ) : (
                                  <div className="text-success">
                                    {formatCurrencyAr(e.targetAmount)}
                                  </div>
                                )}
                                {belowTier || (hasMtd && mtdTarget <= 0 && !noSales) ? (
                                  <div className="text-[10px] text-warning">
                                    لسه متحسبلهوش تارجت
                                  </div>
                                ) : null}
                                {e.mtdSales != null && (
                                  <div className="text-[10px] text-muted-foreground">
                                    مبيعات الشهر {formatCurrencyAr(e.mtdSales)}
                                  </div>
                                )}
                                {e.targetAmount > 0 && (
                                  <div className="text-[10px] text-muted-foreground">
                                    فرق اليوم {formatCurrencyAr(e.targetAmount)}
                                  </div>
                                )}
                              </button>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-brand whitespace-nowrap">
                          {formatCurrencyAr(e.dayTotal)}
                        </td>
                        <td className="px-3 py-2.5">
                          {e.hasPhone ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-success">جاهز</span>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={waBusy || loading}
                                onClick={() => void sendWhatsAppToEmployee(e.empId, e.empName)}
                                className="h-7 px-2 text-[11px] text-success hover:text-success hover:bg-success-soft"
                                title={`إرسال التقرير إلى ${e.empName}`}
                              >
                                <MessageCircle className="h-3 w-3 ml-0.5" />
                                إرسال
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-0.5">
                              <MinusCircle className="h-3 w-3" />
                              بدون رقم
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Owner section ── */}
          <section className="space-y-4 pt-4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-brand/40 bg-brand-soft">
                <Crown className="h-4 w-4 text-brand" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">تقرير المالك</h2>
                <p className="text-xs text-muted-foreground">
                  نظرة سريعة: ربح التشغيل الفعلي · وحركة الخزنة بالفلوس الخارجة فعليًا
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Owner day report */}
              <div className="rounded-2xl border border-brand/25 bg-gradient-to-b from-brand-soft via-card to-card overflow-hidden">
                <div className="px-5 py-4 border-b border-brand/15 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-brand font-medium">تقرير اليوم</div>
                    <h3 className="text-base font-semibold text-foreground mt-0.5">صافي التشغيل الفعلي</h3>
                  </div>
                  <Banknote className="h-5 w-5 text-brand" />
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">صافي ربح اليوم</div>
                    <div
                      className={`text-3xl font-bold ${
                        report.ownerDay.net >= 0 ? 'text-success' : 'text-destructive'
                      }`}
                    >
                      {formatCurrencyAr(report.ownerDay.net)}
                    </div>
                  </div>

                  <OwnerFlowRows
                    rows={[
                      { label: 'مبيعات', amount: report.ownerDay.sales, sign: '+' },
                      { label: 'إيرادات', amount: report.ownerDay.incomes, sign: '+' },
                      { label: 'مصروفات تشغيل', amount: report.ownerDay.operatingExpenses, sign: '−' },
                      { label: 'أساسي موظفين', amount: report.ownerDay.staffBase, sign: '−' },
                      { label: 'تارجت اليوم (فرق)', amount: report.ownerDay.staffTarget, sign: '−' },
                    ]}
                  />

                  <div className="rounded-xl border border-border bg-card px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed">
                    نفس أرقام السيكشن فوق بالظبط · المصروفات هنا{' '}
                    <strong className="text-foreground">بدون سلف</strong> لأن السلف جزء من حساب المرتب
                  </div>
                </div>
              </div>

              {/* Treasury report */}
              <div className="rounded-2xl border border-info/25 bg-gradient-to-b from-info-soft via-card to-card overflow-hidden">
                <div className="px-5 py-4 border-b border-info/15 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-info font-medium">تقرير الخزنة</div>
                    <h3 className="text-base font-semibold text-foreground mt-0.5">حركة الفلوس نقدًا</h3>
                  </div>
                  <Landmark className="h-5 w-5 text-info" />
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">صافي الخزنة</div>
                    <div
                      className={`text-3xl font-bold ${
                        report.treasury.net >= 0 ? 'text-info' : 'text-destructive'
                      }`}
                    >
                      {formatCurrencyAr(report.treasury.net)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>
                        مدخلات{' '}
                        <strong className="text-foreground">
                          {formatCurrencyAr(report.treasury.inflows.total)}
                        </strong>
                      </span>
                      <span className="text-muted-foreground">−</span>
                      <span>
                        مصروفات{' '}
                        <strong className="text-foreground">
                          {formatCurrencyAr(report.treasury.outflows.total)}
                        </strong>
                      </span>
                    </div>
                    <div className="mt-3 rounded-xl border border-info/25 bg-info-soft px-3 py-2.5 flex items-center justify-between gap-3">
                      <span className="text-xs text-info">
                        صافي السيولة بالخزنة حتى اليوم
                        <span className="block text-[10px] text-muted-foreground">
                          من أول الشهر ({report.monthToDate.month})
                        </span>
                      </span>
                      <span
                        className={`text-lg font-bold ${
                          report.monthToDate.treasuryNet >= 0
                            ? 'text-info'
                            : 'text-destructive'
                        }`}
                      >
                        {formatCurrencyAr(report.monthToDate.treasuryNet)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <MiniTile
                      label="من المبيعات"
                      value={formatCurrencyAr(report.treasury.inflows.sales)}
                    />
                    <MiniTile
                      label="من الإيرادات"
                      value={formatCurrencyAr(report.treasury.inflows.incomes)}
                    />
                    <MiniTile
                      label="تشغيل"
                      value={formatCurrencyAr(report.treasury.outflows.operatingTotal)}
                    />
                    <MiniTile
                      label="سلف موظفين"
                      value={formatCurrencyAr(report.treasury.outflows.advancesTotal)}
                      warn={report.treasury.outflows.advancesTotal > 0}
                    />
                  </div>

                  <GroupedBreakdown
                    title="توضيح مصروفات التشغيل"
                    empty="مفيش مصروفات تشغيل"
                    rows={report.treasury.outflows.operatingByCategory}
                    accent="text-destructive"
                  />

                  <GroupedBreakdown
                    title="سلف الموظفين (مجمعة لكل موظف)"
                    empty="مفيش سلف النهاردة"
                    rows={report.treasury.outflows.advancesByEmployee}
                    accent="text-warning"
                  />

                  <div className="rounded-xl border border-info/15 bg-info-soft px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed">
                    الخزنة = الفلوس اللي دخلت − الفلوس اللي طلعت فعليًا (بما فيها السلف).  
                    لو الموظف اخد أكثر من سلفة، بتتجمع له في سطر واحد.
                  </div>
                </div>
              </div>
            </div>

            {/* Employee accounts */}
            <div className="rounded-2xl border border-brand/25 bg-gradient-to-b from-brand-soft via-card to-card overflow-hidden">
              <div className="px-5 py-4 border-b border-brand/15 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] text-brand font-medium">حسابات الموظفين</div>
                  <h3 className="text-base font-semibold text-foreground mt-0.5">
                    كل موظف بقى له كام في الحساب
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    رصيد دفتر الشهر {report.employeeAccounts.payrollMonth} · مع استحقاق اليوم والسلف
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <MiniTile
                    label="استحقاق اليوم"
                    value={formatCurrencyAr(report.employeeAccounts.totalDayCost)}
                  />
                  <MiniTile
                    label="سلف اليوم"
                    value={formatCurrencyAr(report.employeeAccounts.totalAdvancesToday)}
                    warn={report.employeeAccounts.totalAdvancesToday > 0}
                  />
                  <MiniTile
                    label="مجموع الارصدة"
                    value={formatCurrencyAr(report.employeeAccounts.totalLedgerBalance)}
                  />
                </div>
              </div>

              {report.employeeAccounts.rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  مفيش ارصدة موظفين لهذا الشهر
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-background text-muted-foreground text-xs">
                      <tr>
                        <th className="px-4 py-2.5 text-right font-medium">الموظف</th>
                        <th className="px-4 py-2.5 text-right font-medium">اساسي اليوم</th>
                        <th className="px-4 py-2.5 text-right font-medium">تارجت حتى الآن</th>
                        <th className="px-4 py-2.5 text-right font-medium">استحقاق اليوم</th>
                        <th className="px-4 py-2.5 text-right font-medium">سلف اليوم</th>
                        <th className="px-4 py-2.5 text-right font-medium">رصيد الحساب</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.employeeAccounts.rows.map((row) => (
                        <tr
                          key={row.empId}
                          className="border-t border-border hover:bg-card"
                        >
                          <td className="px-4 py-2.5 text-foreground font-medium">{row.empName}</td>
                          <td className="px-4 py-2.5 text-foreground whitespace-nowrap">
                            {formatCurrencyAr(row.dayBase)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {row.mtdTargetAmount != null ? (
                              <button
                                type="button"
                                className="text-right hover:bg-surface-muted rounded-lg px-1.5 py-1 -mx-1.5 transition-colors"
                                onClick={() => setTargetDetailsEmpId(row.empId)}
                                title="عرض تفاصيل حساب التارجت"
                              >
                                <div className="text-success font-medium">
                                  {formatCurrencyAr(row.mtdTargetAmount)}
                                </div>
                                {row.dayTarget > 0 && (
                                  <div className="text-[10px] text-muted-foreground">
                                    فرق اليوم {formatCurrencyAr(row.dayTarget)}
                                  </div>
                                )}
                              </button>
                            ) : (
                              <span className="text-success">
                                {formatCurrencyAr(row.dayTarget)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-brand font-medium whitespace-nowrap">
                            {formatCurrencyAr(row.dayTotal)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {row.advancesToday > 0 ? (
                              <span className="text-warning font-medium">
                                {formatCurrencyAr(row.advancesToday)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span
                              className={`font-bold ${
                                row.ledgerBalance > 0
                                  ? 'text-brand'
                                  : row.ledgerBalance < 0
                                    ? 'text-destructive'
                                    : 'text-muted-foreground'
                              }`}
                            >
                              {formatCurrencyAr(row.ledgerBalance)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-card border-t border-border">
                      <tr className="text-xs text-foreground">
                        <td className="px-4 py-3 font-semibold">الاجمالي</td>
                        <td className="px-4 py-3" colSpan={2} />
                        <td className="px-4 py-3 font-semibold text-brand">
                          {formatCurrencyAr(report.employeeAccounts.totalDayCost)}
                        </td>
                        <td className="px-4 py-3 font-semibold text-warning">
                          {formatCurrencyAr(report.employeeAccounts.totalAdvancesToday)}
                        </td>
                        <td className="px-4 py-3 font-bold text-brand">
                          {formatCurrencyAr(report.employeeAccounts.totalLedgerBalance)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <div className="px-5 py-3 border-t border-brand/10 text-[11px] text-muted-foreground">
                رصيد الحساب = استحقاقات الدفتر (اساسي + تارجت + تمويل) − سلف − صرف مستحقات − خصومات
                لهذا الشهر.
              </div>
            </div>

            {/* Month-to-date net profit — آخر حاجة في التقرير */}
            <MonthToDateCard mtd={report.monthToDate} />
          </section>
        </>
      )}

      {(() => {
        const emp =
          report?.payroll.employees.find((e) => e.empId === targetDetailsEmpId) ?? null;
        return (
          <Dialog
            open={targetDetailsEmpId != null}
            onOpenChange={(open) => {
              if (!open) setTargetDetailsEmpId(null);
            }}
          >
            <DialogContent className="max-w-md bg-background border-border" dir="rtl">
              <DialogHeader>
                <DialogTitle className="text-foreground flex items-center gap-2">
                  <Target className="h-4 w-4 text-success" />
                  تفاصيل التارجت
                  {emp ? ` — ${emp.empName}` : ''}
                </DialogTitle>
              </DialogHeader>
              {emp ? (
                <div className="space-y-3 text-sm">
                  <div className="rounded-xl border border-border bg-card px-3 py-2.5 space-y-1">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">مبيعات الشهر حتى الآن</span>
                      <span className="text-foreground font-medium">
                        {emp.mtdSales != null ? formatCurrencyAr(emp.mtdSales) : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">تارجت الشهر (حتى الآن)</span>
                      <span className="text-success font-semibold">
                        {emp.mtdTargetAmount != null
                          ? formatCurrencyAr(emp.mtdTargetAmount)
                          : formatCurrencyAr(emp.targetAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">فرق اليوم (استحقاق اليوم)</span>
                      <span className="text-brand font-medium">
                        {formatCurrencyAr(emp.targetAmount)}
                      </span>
                    </div>
                    {emp.mtdSales != null &&
                      emp.mtdSales > 0 &&
                      (emp.mtdTargetAmount ?? 0) <= 0 && (
                        <p className="text-[11px] text-warning pt-1">
                          لسه متحسبلهوش تارجت — الإجمالي تحت أول شريحة متفق عليها.
                        </p>
                      )}
                  </div>

                  {emp.targetBreakdown && emp.targetBreakdown.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground font-medium">
                        طريقة الحسبة حسب اتفاق التارجت (إعدادات الموظف في HR)
                      </p>
                      {emp.targetBreakdown.map((row, i) => (
                        <div
                          key={`${row.from}-${i}`}
                          className="rounded-lg border border-border px-3 py-2 text-xs text-foreground"
                        >
                          من {formatCurrencyAr(row.from)}
                          {row.to != null ? ` إلى ${formatCurrencyAr(row.to)}` : ' فأعلى'}
                          {' · '}
                          {row.ratePercent}% على {formatCurrencyAr(row.eligibleAmount)}
                          {' → '}
                          <span className="text-success font-medium">
                            {formatCurrencyAr(row.targetAmount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      تفاصيل الشرائح تظهر بعد إعادة توليد التارجت بالنظام الشهري التراكمي.
                    </p>
                  )}
                </div>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setTargetDetailsEmpId(null)}>
                  إغلاق
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      <Dialog open={employeePickOpen} onOpenChange={setEmployeePickOpen}>
        <DialogContent className="max-w-md bg-background border-border" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-foreground">إرسال التقرير لموظف معيّن</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            يوم {report?.workDateLabelAr ?? report?.workDate} — هيتبعت لموظف واحد بس، مش للكل.
          </p>
          {report && (
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground">اختر الموظف</label>
              <select
                value={selectedEmpId}
                onChange={(e) => setSelectedEmpId(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
              >
                {report.payroll.employees.filter((e) => e.hasPhone).length === 0 ? (
                  <option value="">مفيش موظفين جاهزين</option>
                ) : (
                  report.payroll.employees
                    .filter((e) => e.hasPhone)
                    .map((e) => (
                      <option key={e.empId} value={e.empId}>
                        {e.empName}
                      </option>
                    ))
                )}
              </select>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setEmployeePickOpen(false)}>
              إلغاء
            </Button>
            <Button
              disabled={!selectedEmpId || waBusy}
              onClick={() => {
                const emp = report?.payroll.employees.find(
                  (e) => String(e.empId) === selectedEmpId,
                );
                if (!emp) return;
                void sendWhatsAppToEmployee(emp.empId, emp.empName);
              }}
              className="bg-success hover:bg-success/85 text-success-foreground"
            >
              <MessageCircle className="h-4 w-4 ml-1" />
              إرسال لهذا الموظف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ownerPreviewOpen} onOpenChange={setOwnerPreviewOpen}>
        <DialogContent className="max-w-lg bg-background border-border" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              معاينة تقرير المالك
              {ownerPreview?.ownerName ? ` — ${ownerPreview.ownerName}` : ''}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">{ownerPreview?.meta}</p>
          <pre className="whitespace-pre-wrap text-sm text-foreground bg-card border border-border rounded-lg p-4 max-h-[55vh] overflow-y-auto font-sans leading-relaxed">
            {ownerPreview?.message}
          </pre>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOwnerPreviewOpen(false)}>
              إغلاق
            </Button>
            <Button
              disabled={!ownerPreview?.canSend || waBusy}
              onClick={() => void sendOwnerWhatsApp()}
              className="bg-primary hover:bg-primary-hover text-primary-foreground"
            >
              <Crown className="h-4 w-4 ml-1" />
              إرسال الآن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={recipientsOpen} onOpenChange={setRecipientsOpen}>
        <DialogContent className="max-w-md bg-background border-border" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <UserCog className="h-4 w-4 text-info" />
              مستلمو تقرير المالك
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            التقرير بيتبعت للموظفين اللي دورهم في النظام{' '}
            <span className="text-info font-medium">
              {recipients?.roleLabel ?? 'مدير'}
            </span>
            . المستلم الأساسي متعلّم بنجمة.
          </p>

          {recipientsLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="h-5 w-5 animate-spin ml-2" />
              جاري تحميل المستلمين...
            </div>
          ) : recipientsError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive-soft p-3 text-destructive text-xs flex gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {recipientsError}
            </div>
          ) : !recipients || recipients.rows.length === 0 ? (
            <div className="rounded-lg border border-warning/25 bg-warning-soft p-4 text-center text-xs text-warning space-y-1">
              <p>مفيش أي موظف دوره «مدير» في النظام.</p>
              <p className="text-muted-foreground">
                عيّن الوظيفة «مدير» لموظف (زي طارق) من إدارة الموظفين عشان يستلم
                التقرير.
              </p>
            </div>
          ) : (
            <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
              {recipients.rows.map((r) => (
                <li
                  key={r.empId}
                  className={`rounded-xl border px-3 py-2.5 flex items-center justify-between gap-3 ${
                    r.isPrimary
                      ? 'border-brand/40 bg-brand-soft'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-foreground font-medium truncate">
                        {r.name}
                      </span>
                      {r.isPrimary && (
                        <span
                          className="text-brand text-xs"
                          title="المستلم الأساسي"
                        >
                          ★
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {r.phone ? `واتساب: ${r.phone}` : 'بدون رقم واتساب'}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="inline-flex items-center rounded-full border border-info/30 bg-info-soft px-2 py-0.5 text-[10px] text-info">
                      {r.role ?? 'بدون دور'}
                    </span>
                    <span
                      className={`text-[10px] ${
                        r.hasPhone ? 'text-success' : 'text-muted-foreground'
                      }`}
                    >
                      {r.hasPhone ? 'جاهز للإرسال' : 'بدون رقم'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setRecipientsOpen(false)}>
              إغلاق
            </Button>
            <Button
              disabled={!report || waBusy || loading}
              onClick={() => {
                setRecipientsOpen(false);
                void previewOwnerWhatsApp();
              }}
              className="bg-primary hover:bg-primary-hover text-primary-foreground"
            >
              <Crown className="h-4 w-4 ml-1" />
              معاينة التقرير
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OwnerFlowRows({
  rows,
}: {
  rows: Array<{ label: string; amount: number; sign: '+' | '−' }>;
}) {
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li
          key={r.label}
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          <span className="text-muted-foreground">
            <span className={r.sign === '+' ? 'text-success' : 'text-destructive'}>{r.sign}</span>{' '}
            {r.label}
          </span>
          <span className="font-medium text-foreground">{formatCurrencyAr(r.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

function MiniTile({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        warn ? 'border-warning/25 bg-warning-soft' : 'border-border bg-card'
      }`}
    >
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${warn ? 'text-warning' : 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}

function GroupedBreakdown({
  title,
  empty,
  rows,
  accent,
}: {
  title: string;
  empty: string;
  rows: FullDayGroupedMoneyLine[];
  accent: string;
  badgeEmoji?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-card text-xs font-medium text-foreground">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">{empty}</div>
      ) : (
        <ul className="max-h-44 overflow-y-auto divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="px-3 py-2 flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="text-foreground truncate">{row.label}</div>
                {row.meta && (
                  <div className="text-[10px] text-muted-foreground">{row.meta}</div>
                )}
              </div>
              <div className={`shrink-0 font-semibold ${accent}`}>
                {formatCurrencyAr(row.amount)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MonthToDateCard({ mtd }: { mtd: FullDayMonthToDate }) {
  const profitPositive = mtd.netProfit >= 0;
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-6 ${
        profitPositive
          ? 'border-success/30 bg-gradient-to-l from-success-soft via-card to-card'
          : 'border-destructive/30 bg-gradient-to-l from-destructive-soft via-card to-card'
      }`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <CalendarRange className="h-4 w-4 text-success" />
        صافي الربح من أول الشهر حتى اليوم
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          {mtd.fromDate} ← {mtd.toDate}
        </span>
      </div>
      <div
        className={`text-4xl sm:text-5xl font-bold tracking-tight ${
          profitPositive ? 'text-success' : 'text-destructive'
        }`}
      >
        {formatCurrencyAr(mtd.netProfit)}
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
        <MiniTile label="مبيعات الشهر" value={formatCurrencyAr(mtd.sales)} />
        <MiniTile label="إيرادات الشهر" value={formatCurrencyAr(mtd.incomes)} />
        <MiniTile
          label="مصروفات التشغيل"
          value={formatCurrencyAr(mtd.operatingExpenses)}
        />
        <MiniTile label="أساسي الموظفين" value={formatCurrencyAr(mtd.staffBase)} />
        <MiniTile label="تارجت الموظفين (حتى الآن)" value={formatCurrencyAr(mtd.staffTarget)} />
        <MiniTile
          label="سلف الموظفين"
          value={formatCurrencyAr(mtd.advances)}
          warn={mtd.advances > 0}
        />
      </div>

      <div className="mt-3 rounded-xl border border-info/25 bg-info-soft px-4 py-3 flex items-center justify-between gap-3">
        <span className="text-sm text-info">
          صافي السيولة بالخزنة حتى اليوم
        </span>
        <span
          className={`text-xl font-bold ${
            mtd.treasuryNet >= 0 ? 'text-info' : 'text-destructive'
          }`}
        >
          {formatCurrencyAr(mtd.treasuryNet)}
        </span>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
        الربح الشهري = (مبيعات + إيرادات) − (مصروفات + أساسي + تارجت) · صافي
        السيولة = (مبيعات + إيرادات) − (مصروفات + سلف) — كله تراكمي من أول الشهر.
      </p>
    </div>
  );
}

function PaymentMixCard({ mix }: { mix: FullDayPaymentMix }) {
  const barColors = [
    'bg-success',
    'bg-info',
    'bg-brand',
    'bg-warning',
    'bg-destructive',
    'bg-success',
  ];
  return (
    <section className="rounded-2xl border border-info/25 bg-gradient-to-b from-info-soft via-card to-card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-info/15 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-info" />
            الفلوس الداخلة متقسمة على طرق الدفع
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            كام كاش · كام فيزا · وهكذا (مبيعات + إيرادات)
          </p>
        </div>
        <div className="text-left">
          <div className="text-[10px] text-muted-foreground">إجمالي الداخل</div>
          <div className="text-lg font-bold text-info">
            {formatCurrencyAr(mix.total)}
          </div>
        </div>
      </div>

      {mix.rows.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground text-sm">
          مفيش فلوس داخلة مسجّلة اليوم
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {mix.rows.map((row, i) => (
            <li key={row.method} className="px-5 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                      barColors[i % barColors.length]
                    }`}
                  />
                  <span className="text-foreground font-medium truncate">
                    {row.method}
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {row.percent}%
                  </span>
                </div>
                <span className="font-semibold text-foreground shrink-0">
                  {formatCurrencyAr(row.total)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${barColors[i % barColors.length]}`}
                  style={{ width: `${Math.min(100, Math.max(2, row.percent))}%` }}
                />
              </div>
              {(row.salesTotal > 0 && row.incomesTotal > 0) && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  مبيعات {formatCurrencyAr(row.salesTotal)} · إيرادات{' '}
                  {formatCurrencyAr(row.incomesTotal)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatCard({
  title,
  value,
  hint,
  icon,
  tone,
}: {
  title: string;
  value: string;
  hint: string;
  icon: ReactNode;
  tone: 'gold' | 'blue' | 'rose' | 'amber';
}) {
  const tones = {
    gold: 'border-brand/25 bg-brand-soft text-brand',
    blue: 'border-info/25 bg-info-soft text-info',
    rose: 'border-destructive/25 bg-destructive-soft text-destructive',
    amber: 'border-warning/25 bg-warning-soft text-warning',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between mb-2 opacity-80">
        <span className="text-xs text-muted-foreground">{title}</span>
        {icon}
      </div>
      <div className="text-xl font-bold text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{hint}</div>
    </div>
  );
}

function MoneyList({
  title,
  empty,
  subtitle,
  total,
  lines,
  accent,
}: {
  title: string;
  empty: string;
  subtitle?: string;
  total: number;
  lines: FullDayReport['incomes']['lines'];
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        <span className={`text-sm font-bold shrink-0 ${accent}`}>{formatCurrencyAr(total)}</span>
      </div>
      {lines.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground text-sm">{empty}</div>
      ) : (
        <ul className="divide-y divide-border max-h-72 overflow-y-auto">
          {lines.map((line) => (
            <li key={line.id} className="px-4 py-2.5 flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="text-foreground truncate">{line.label}</div>
                {line.meta && (
                  <div className="text-[11px] text-muted-foreground truncate">{line.meta}</div>
                )}
              </div>
              <div className={`shrink-0 font-medium ${accent}`}>
                {formatCurrencyAr(line.amount)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
