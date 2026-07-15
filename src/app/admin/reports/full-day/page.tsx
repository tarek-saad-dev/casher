'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Landmark,
  Loader2,
  MessageCircle,
  MinusCircle,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import type { FullDayGroupedMoneyLine } from '@/lib/reports/full-day-report.types';
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

      const lines: string[] = [];
      if (Array.isArray(data.results)) {
        for (const r of data.results as Array<{
          empName?: string;
          status?: string;
          reasonAr?: string;
          reason?: string;
        }>) {
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
      } else {
        setWaSuccess(`تم إرسال ${sent} رسالة بالدور${skipped ? ` (تخطي ${skipped})` : ''}`);
      }
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'خطأ في الإرسال');
    } finally {
      setWaBusy(false);
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
        `إرسال تقرير المالك ليوم ${report.workDate} إلى ${ownerLabel}؟`,
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
      setWaSuccess(`تم إرسال تقرير المالك إلى ${data.ownerName || 'طارق'}`);
      setWaLog([`✓ المالك: ${data.ownerName || 'طارق'} (${data.phone || '—'})`]);
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'خطأ في إرسال المالك');
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
      <div className="sticky top-2 z-20 rounded-2xl border border-[#D6A84F]/30 bg-zinc-950/90 backdrop-blur p-4 shadow-lg shadow-black/20 space-y-3">
        <div className="flex flex-wrap items-end gap-3 justify-between">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-[11px] text-zinc-400">تاريخ اليوم</label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-zinc-900 border-zinc-700 w-[160px]"
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
              className="bg-[#D6A84F] hover:bg-[#c4983f] text-black"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 ml-1" />}
              عرض
            </Button>
            <Button variant="ghost" onClick={() => applyDate(getCairoTodayStr())} className="text-zinc-400">
              النهاردة
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <Button
              disabled={!report || waBusy || loading}
              onClick={() => void sendWhatsAppSequential()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white min-w-[180px]"
            >
              {waBusy ? (
                <Loader2 className="h-4 w-4 animate-spin ml-1" />
              ) : (
                <MessageCircle className="h-4 w-4 ml-1" />
              )}
              للموظفين
              {report ? ` (${report.whatsapp.readyToSend})` : ''}
            </Button>
            <Button
              disabled={!report || waBusy || loading}
              variant="outline"
              onClick={() => void previewOwnerWhatsApp()}
              className="border-[#D6A84F]/40 text-[#D6A84F]"
            >
              معاينة المالك
            </Button>
            <Button
              disabled={!report || waBusy || loading}
              onClick={() => void sendOwnerWhatsApp()}
              className="bg-[#D6A84F] hover:bg-[#c4983f] text-black min-w-[160px]"
            >
              {waBusy ? (
                <Loader2 className="h-4 w-4 animate-spin ml-1" />
              ) : (
                <Crown className="h-4 w-4 ml-1" />
              )}
              إرسال للمدير
            </Button>
          </div>
        </div>

        {report && (
          <p className="text-xs text-zinc-500">
            {report.workDateLabelAr}
            {report.whatsapp.missingPhone > 0 && (
              <span className="text-amber-400/90 mr-2">
                · {report.whatsapp.missingPhone} بدون رقم واتساب
              </span>
            )}
          </p>
        )}

        {waError && (
          <div className="text-xs text-red-300 flex items-start gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{waError}</span>
          </div>
        )}
        {waSuccess && (
          <div className="text-xs text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {waSuccess}
          </div>
        )}
        {waLog.length > 0 && (
          <div className="max-h-28 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-[11px] text-zinc-400 space-y-0.5 font-mono">
            {waLog.map((line, i) => (
              <div key={`${i}-${line}`}>{line}</div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300 flex gap-2">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {loading && !report && (
        <div className="flex items-center justify-center py-20 text-zinc-400">
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
                ? 'border-emerald-500/30 bg-gradient-to-l from-emerald-500/10 via-zinc-950 to-zinc-950'
                : 'border-rose-500/30 bg-gradient-to-l from-rose-500/10 via-zinc-950 to-zinc-950'
            }`}
          >
            <div className="text-xs text-zinc-400 mb-1">صافي ربح اليوم النهائي</div>
            <div
              className={`text-4xl sm:text-5xl font-bold tracking-tight ${
                report.profit.net >= 0 ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {formatCurrencyAr(report.profit.net)}
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-zinc-400">
              <span>
                داخل: <strong className="text-zinc-200">{formatCurrencyAr(report.profit.totalIn)}</strong>
              </span>
              <span className="text-zinc-600">−</span>
              <span>
                خارج: <strong className="text-zinc-200">{formatCurrencyAr(report.profit.totalOut)}</strong>
              </span>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              داخل = مبيعات + إيرادات · خارج = مصروفات + أساسي الموظفين + التارجت
            </p>
          </div>

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
              accent="text-blue-300"
            />
            <MoneyList
              title="مصروفات اليوم"
              empty="مفيش مصروفات تشغيلية اليوم"
              subtitle="بدون سلف الموظفين (السلف جزء من حساب المرتب)"
              total={report.expenses.total}
              lines={report.expenses.lines}
              accent="text-rose-300"
            />
          </div>

          {/* Staff section */}
          <section className="rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/60 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-[#D6A84F]" />
                  مرتبات · تارجت · مواعيد اليوم
                </h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  حضور {report.payroll.presentCount} من {report.payroll.employeeCount} · أساسي{' '}
                  {formatCurrencyAr(report.payroll.wageTotal)} · تارجت{' '}
                  {formatCurrencyAr(report.payroll.targetTotal)}
                </p>
              </div>
              <div className="flex gap-3 text-xs text-zinc-400">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> مواعيد
                </span>
                <span className="inline-flex items-center gap-1">
                  <Target className="h-3.5 w-3.5" /> تارجت
                </span>
              </div>
            </div>

            {report.payroll.employees.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 text-sm">
                مفيش يوميات مولَّدة لهذا اليوم — ولّد من تبويب يوميات الموظفين أولاً
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-zinc-950 text-zinc-500 text-xs">
                    <tr>
                      <th className="px-3 py-2.5 text-right font-medium">الموظف</th>
                      <th className="px-3 py-2.5 text-right font-medium">حضور</th>
                      <th className="px-3 py-2.5 text-right font-medium">انصراف</th>
                      <th className="px-3 py-2.5 text-right font-medium">ساعات</th>
                      <th className="px-3 py-2.5 text-right font-medium">الأساسي</th>
                      <th className="px-3 py-2.5 text-right font-medium">تارجت</th>
                      <th className="px-3 py-2.5 text-right font-medium">الإجمالي</th>
                      <th className="px-3 py-2.5 text-right font-medium">واتساب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.payroll.employees.map((e) => (
                      <tr key={e.empId} className="border-t border-zinc-800/80 hover:bg-zinc-900/40">
                        <td className="px-3 py-2.5">
                          <div className="text-zinc-100 font-medium">{e.empName}</div>
                          {e.attendanceStatus && (
                            <div className="text-[10px] text-zinc-500">{e.attendanceStatus}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-300 whitespace-nowrap">
                          {formatTime12hAr(e.checkIn) ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-300 whitespace-nowrap">
                          {formatTime12hAr(e.checkOut) ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-300 whitespace-nowrap">
                          {hoursLabel(e.actualHours)}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-200 whitespace-nowrap">
                          {formatCurrencyAr(e.baseWage)}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="text-emerald-300">{formatCurrencyAr(e.targetAmount)}</div>
                          {e.targetSales != null && (
                            <div className="text-[10px] text-zinc-500">
                              مبيعات {formatCurrencyAr(e.targetSales)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-[#D6A84F] whitespace-nowrap">
                          {formatCurrencyAr(e.dayTotal)}
                        </td>
                        <td className="px-3 py-2.5">
                          {e.hasPhone ? (
                            <span className="text-[11px] text-emerald-400">جاهز</span>
                          ) : (
                            <span className="text-[11px] text-zinc-500 inline-flex items-center gap-0.5">
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
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#D6A84F]/40 bg-[#D6A84F]/10">
                <Crown className="h-4 w-4 text-[#D6A84F]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-50">تقرير المالك</h2>
                <p className="text-xs text-zinc-500">
                  نظرة سريعة: ربح التشغيل الفعلي · وحركة الخزنة بالفلوس الخارجة فعليًا
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Owner day report */}
              <div className="rounded-2xl border border-[#D6A84F]/25 bg-gradient-to-b from-[#D6A84F]/8 via-zinc-950 to-zinc-950 overflow-hidden">
                <div className="px-5 py-4 border-b border-[#D6A84F]/15 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-[#D6A84F]/80 font-medium">تقرير اليوم</div>
                    <h3 className="text-base font-semibold text-zinc-50 mt-0.5">صافي التشغيل الفعلي</h3>
                  </div>
                  <Banknote className="h-5 w-5 text-[#D6A84F]/70" />
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">صافي ربح اليوم</div>
                    <div
                      className={`text-3xl font-bold ${
                        report.ownerDay.net >= 0 ? 'text-emerald-300' : 'text-rose-300'
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
                      { label: 'تارجت', amount: report.ownerDay.staffTarget, sign: '−' },
                    ]}
                  />

                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-[11px] text-zinc-500 leading-relaxed">
                    نفس أرقام السيكشن فوق بالظبط · المصروفات هنا{' '}
                    <strong className="text-zinc-300">بدون سلف</strong> لأن السلف جزء من حساب المرتب
                  </div>
                </div>
              </div>

              {/* Treasury report */}
              <div className="rounded-2xl border border-cyan-500/25 bg-gradient-to-b from-cyan-500/10 via-zinc-950 to-zinc-950 overflow-hidden">
                <div className="px-5 py-4 border-b border-cyan-500/15 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-cyan-300/80 font-medium">تقرير الخزنة</div>
                    <h3 className="text-base font-semibold text-zinc-50 mt-0.5">حركة الفلوس نقدًا</h3>
                  </div>
                  <Landmark className="h-5 w-5 text-cyan-300/70" />
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">صافي الخزنة</div>
                    <div
                      className={`text-3xl font-bold ${
                        report.treasury.net >= 0 ? 'text-cyan-300' : 'text-rose-300'
                      }`}
                    >
                      {formatCurrencyAr(report.treasury.net)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-400">
                      <span>
                        مدخلات{' '}
                        <strong className="text-zinc-200">
                          {formatCurrencyAr(report.treasury.inflows.total)}
                        </strong>
                      </span>
                      <span className="text-zinc-600">−</span>
                      <span>
                        مصروفات{' '}
                        <strong className="text-zinc-200">
                          {formatCurrencyAr(report.treasury.outflows.total)}
                        </strong>
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
                    accent="text-rose-300"
                  />

                  <GroupedBreakdown
                    title="سلف الموظفين (مجمعة لكل موظف)"
                    empty="مفيش سلف النهاردة"
                    rows={report.treasury.outflows.advancesByEmployee}
                    accent="text-orange-300"
                  />

                  <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 px-3 py-2.5 text-[11px] text-zinc-500 leading-relaxed">
                    الخزنة = الفلوس اللي دخلت − الفلوس اللي طلعت فعليًا (بما فيها السلف).  
                    لو الموظف اخد أكثر من سلفة، بتتجمع له في سطر واحد.
                  </div>
                </div>
              </div>
            </div>

            {/* Employee accounts */}
            <div className="rounded-2xl border border-violet-500/25 bg-gradient-to-b from-violet-500/10 via-zinc-950 to-zinc-950 overflow-hidden">
              <div className="px-5 py-4 border-b border-violet-500/15 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] text-violet-300/80 font-medium">حسابات الموظفين</div>
                  <h3 className="text-base font-semibold text-zinc-50 mt-0.5">
                    كل موظف بقى له كام في الحساب
                  </h3>
                  <p className="text-[11px] text-zinc-500 mt-1">
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
                <div className="p-8 text-center text-sm text-zinc-500">
                  مفيش ارصدة موظفين لهذا الشهر
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-zinc-950/80 text-zinc-500 text-xs">
                      <tr>
                        <th className="px-4 py-2.5 text-right font-medium">الموظف</th>
                        <th className="px-4 py-2.5 text-right font-medium">اساسي اليوم</th>
                        <th className="px-4 py-2.5 text-right font-medium">تارجت اليوم</th>
                        <th className="px-4 py-2.5 text-right font-medium">استحقاق اليوم</th>
                        <th className="px-4 py-2.5 text-right font-medium">سلف اليوم</th>
                        <th className="px-4 py-2.5 text-right font-medium">رصيد الحساب</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.employeeAccounts.rows.map((row) => (
                        <tr
                          key={row.empId}
                          className="border-t border-zinc-800/80 hover:bg-zinc-900/40"
                        >
                          <td className="px-4 py-2.5 text-zinc-100 font-medium">{row.empName}</td>
                          <td className="px-4 py-2.5 text-zinc-300 whitespace-nowrap">
                            {formatCurrencyAr(row.dayBase)}
                          </td>
                          <td className="px-4 py-2.5 text-emerald-300/90 whitespace-nowrap">
                            {formatCurrencyAr(row.dayTarget)}
                          </td>
                          <td className="px-4 py-2.5 text-[#D6A84F] font-medium whitespace-nowrap">
                            {formatCurrencyAr(row.dayTotal)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {row.advancesToday > 0 ? (
                              <span className="text-orange-300 font-medium">
                                {formatCurrencyAr(row.advancesToday)}
                              </span>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span
                              className={`font-bold ${
                                row.ledgerBalance > 0
                                  ? 'text-violet-300'
                                  : row.ledgerBalance < 0
                                    ? 'text-rose-300'
                                    : 'text-zinc-500'
                              }`}
                            >
                              {formatCurrencyAr(row.ledgerBalance)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-zinc-900/70 border-t border-zinc-700">
                      <tr className="text-xs text-zinc-300">
                        <td className="px-4 py-3 font-semibold">الاجمالي</td>
                        <td className="px-4 py-3" colSpan={2} />
                        <td className="px-4 py-3 font-semibold text-[#D6A84F]">
                          {formatCurrencyAr(report.employeeAccounts.totalDayCost)}
                        </td>
                        <td className="px-4 py-3 font-semibold text-orange-300">
                          {formatCurrencyAr(report.employeeAccounts.totalAdvancesToday)}
                        </td>
                        <td className="px-4 py-3 font-bold text-violet-300">
                          {formatCurrencyAr(report.employeeAccounts.totalLedgerBalance)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <div className="px-5 py-3 border-t border-violet-500/10 text-[11px] text-zinc-500">
                رصيد الحساب = استحقاقات الدفتر (اساسي + تارجت + تمويل) − سلف − صرف مستحقات − خصومات
                لهذا الشهر.
              </div>
            </div>
          </section>
        </>
      )}

      <Dialog open={ownerPreviewOpen} onOpenChange={setOwnerPreviewOpen}>
        <DialogContent className="max-w-lg bg-zinc-950 border-zinc-800" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">
              معاينة تقرير المالك
              {ownerPreview?.ownerName ? ` — ${ownerPreview.ownerName}` : ''}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-zinc-400">{ownerPreview?.meta}</p>
          <pre className="whitespace-pre-wrap text-sm text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-lg p-4 max-h-[55vh] overflow-y-auto font-sans leading-relaxed">
            {ownerPreview?.message}
          </pre>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOwnerPreviewOpen(false)}>
              إغلاق
            </Button>
            <Button
              disabled={!ownerPreview?.canSend || waBusy}
              onClick={() => void sendOwnerWhatsApp()}
              className="bg-[#D6A84F] hover:bg-[#c4983f] text-black"
            >
              <Crown className="h-4 w-4 ml-1" />
              إرسال الآن
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
          className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-sm"
        >
          <span className="text-zinc-400">
            <span className={r.sign === '+' ? 'text-emerald-400' : 'text-rose-400'}>{r.sign}</span>{' '}
            {r.label}
          </span>
          <span className="font-medium text-zinc-100">{formatCurrencyAr(r.amount)}</span>
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
        warn ? 'border-orange-500/25 bg-orange-500/5' : 'border-zinc-800 bg-zinc-900/50'
      }`}
    >
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`text-sm font-semibold ${warn ? 'text-orange-300' : 'text-zinc-100'}`}>
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
    <div className="rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/50 text-xs font-medium text-zinc-300">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-4 text-center text-[11px] text-zinc-500">{empty}</div>
      ) : (
        <ul className="max-h-44 overflow-y-auto divide-y divide-zinc-800/80">
          {rows.map((row) => (
            <li key={row.key} className="px-3 py-2 flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="text-zinc-200 truncate">{row.label}</div>
                {row.meta && (
                  <div className="text-[10px] text-zinc-500">{row.meta}</div>
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
    gold: 'border-[#D6A84F]/25 bg-[#D6A84F]/5 text-[#D6A84F]',
    blue: 'border-blue-500/25 bg-blue-500/5 text-blue-300',
    rose: 'border-rose-500/25 bg-rose-500/5 text-rose-300',
    amber: 'border-amber-500/25 bg-amber-500/5 text-amber-300',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between mb-2 opacity-80">
        <span className="text-xs text-zinc-400">{title}</span>
        {icon}
      </div>
      <div className="text-xl font-bold text-zinc-50">{value}</div>
      <div className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{hint}</div>
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
    <div className="rounded-2xl border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          {subtitle && <p className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
        <span className={`text-sm font-bold shrink-0 ${accent}`}>{formatCurrencyAr(total)}</span>
      </div>
      {lines.length === 0 ? (
        <div className="p-6 text-center text-zinc-500 text-sm">{empty}</div>
      ) : (
        <ul className="divide-y divide-zinc-800/80 max-h-72 overflow-y-auto">
          {lines.map((line) => (
            <li key={line.id} className="px-4 py-2.5 flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="text-zinc-200 truncate">{line.label}</div>
                {line.meta && (
                  <div className="text-[11px] text-zinc-500 truncate">{line.meta}</div>
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
