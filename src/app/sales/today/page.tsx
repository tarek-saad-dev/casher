'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, RotateCcw, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToastProvider, useToast } from '@/components/ui/toast';
import PageHeader from '@/components/shared/PageHeader';
import Toolbar from '@/components/shared/Toolbar';
import EmptyState from '@/components/shared/EmptyState';
import TodaySalesKpiCards from '@/components/sales/TodaySalesKpiCards';
import ByShiftView from '@/components/sales/ByShiftView';
import ByPaymentMethodView from '@/components/sales/ByPaymentMethodView';
import ByBarberView from '@/components/sales/ByBarberView';
import ByServiceView from '@/components/sales/ByServiceView';
import ByHourView from '@/components/sales/ByHourView';
import TodaySalesTransactionsTable from '@/components/sales/TodaySalesTransactionsTable';
import { usePermission } from '@/hooks/usePermission';
import type { TodaySalesData } from '@/lib/types/today-sales';

type AnalysisMode = 'overview' | 'shift' | 'payment' | 'barber' | 'service' | 'hour';

const ANALYSIS_MODES: { key: AnalysisMode; label: string }[] = [
  { key: 'overview', label: 'نظرة عامة' },
  { key: 'shift', label: 'حسب الوردية' },
  { key: 'payment', label: 'حسب الدفع' },
  { key: 'barber', label: 'حسب الحلاق' },
  { key: 'service', label: 'حسب الخدمة' },
  { key: 'hour', label: 'حسب الساعة' },
];

function TodaySalesPageInner() {
  const router = useRouter();
  const { toast } = useToast();
  const canDelete = usePermission('sales.delete');
  const [data, setData] = useState<TodaySalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('overview');
  const [selectedDate, setSelectedDate] = useState('');

  useEffect(() => {
    document.title = 'مبيعات اليوم | نظام نقاط البيع';
  }, []);

  const loadSalesData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (selectedDate) params.set('date', selectedDate);

      const response = await fetch(`/api/sales/today?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.error || 'فشل تحميل البيانات');
        setData(null);
        return;
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error('Error loading today sales:', err);
      setError('خطأ في الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    loadSalesData();
  }, [loadSalesData]);

  const setQuickDate = (type: 'today' | 'yesterday') => {
    if (type === 'today') {
      setSelectedDate('');
      return;
    }
    const date = new Date();
    date.setDate(date.getDate() - 1);
    setSelectedDate(date.toISOString().split('T')[0]);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background" dir="rtl">
      <div className="border-b border-border bg-card/80 px-4 py-4 backdrop-blur-sm sm:px-6">
        <PageHeader
          title="مبيعات اليوم"
          description="تحليل شامل لمبيعات اليوم من عدة زوايا"
          icon={<TrendingUp />}
          eyebrow="التشغيل اليومي"
        >
          <Toolbar
            filters={
              <>
                <Button
                  variant={!selectedDate ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setQuickDate('today')}
                >
                  <Calendar className="ms-2 size-4" aria-hidden />
                  اليوم
                </Button>
                <Button variant="outline" size="sm" onClick={() => setQuickDate('yesterday')}>
                  أمس
                </Button>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  aria-label="اختيار تاريخ المبيعات"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </>
            }
            actions={
              <Button variant="outline" size="sm" onClick={loadSalesData} disabled={loading}>
                <RotateCcw className={`ms-2 size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
                تحديث
              </Button>
            }
          />
        </PageHeader>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 p-4 sm:p-6">
          {loading && !data ? (
            <div className="space-y-4" aria-busy="true" aria-live="polite">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
          ) : null}

          {error && !loading ? (
            <EmptyState
              kind="error"
              title="تعذر تحميل مبيعات اليوم"
              description={error}
              action={{ label: 'إعادة المحاولة', onClick: loadSalesData }}
            />
          ) : null}

          {data && !error ? (
            <>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="size-4" aria-hidden />
                البيانات لتاريخ:{' '}
                {new Date(data.date).toLocaleDateString('ar-EG', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>

              <TodaySalesKpiCards kpi={data.kpi} loading={loading} />

              <div
                role="tablist"
                aria-label="زوايا التحليل"
                className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
              >
                {ANALYSIS_MODES.map((mode) => {
                  const selected = analysisMode === mode.key;
                  return (
                    <button
                      key={mode.key}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setAnalysisMode(mode.key)}
                      className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors sm:min-w-[6.5rem] ${
                        selected
                          ? 'bg-brand-soft text-brand border border-brand/20'
                          : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground'
                      }`}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>

              <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
                {analysisMode === 'overview' ? (
                  <div className="space-y-6">
                    <div>
                      <h3 className="mb-4 text-lg font-bold text-foreground">أفضل 3 ورديات</h3>
                      <ByShiftView shifts={data.byShift.slice(0, 3)} />
                    </div>
                    <div>
                      <h3 className="mb-4 text-lg font-bold text-foreground">طرق الدفع</h3>
                      <ByPaymentMethodView paymentMethods={data.byPaymentMethod} />
                    </div>
                    <div>
                      <h3 className="mb-4 text-lg font-bold text-foreground">أفضل 3 حلاقين</h3>
                      <ByBarberView barbers={data.byBarber.slice(0, 3)} />
                    </div>
                  </div>
                ) : null}

                {analysisMode === 'shift' ? (
                  <div>
                    <h3 className="mb-4 text-lg font-bold text-foreground">التحليل حسب الوردية</h3>
                    <ByShiftView shifts={data.byShift} />
                  </div>
                ) : null}

                {analysisMode === 'payment' ? (
                  <div>
                    <h3 className="mb-4 text-lg font-bold text-foreground">التحليل حسب طريقة الدفع</h3>
                    <ByPaymentMethodView paymentMethods={data.byPaymentMethod} />
                  </div>
                ) : null}

                {analysisMode === 'barber' ? (
                  <div>
                    <h3 className="mb-4 text-lg font-bold text-foreground">التحليل حسب الحلاق</h3>
                    <ByBarberView barbers={data.byBarber} />
                  </div>
                ) : null}

                {analysisMode === 'service' ? (
                  <div>
                    <h3 className="mb-4 text-lg font-bold text-foreground">التحليل حسب الخدمة</h3>
                    <ByServiceView services={data.byService} />
                  </div>
                ) : null}

                {analysisMode === 'hour' ? (
                  <div>
                    <h3 className="mb-4 text-lg font-bold text-foreground">التحليل حسب الساعة</h3>
                    <ByHourView hourly={data.byHour} />
                  </div>
                ) : null}
              </section>

              <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
                <h3 className="mb-4 text-lg font-bold text-foreground">تفاصيل المعاملات</h3>
                <TodaySalesTransactionsTable
                  transactions={data.transactions}
                  loading={loading}
                  onEdit={(txn) => {
                    router.push(`/income/pos?edit=${txn.invId}`);
                  }}
                  onDelete={(invId) => {
                    toast({ tone: 'success', title: `تم حذف الفاتورة #${invId} بنجاح` });
                    loadSalesData();
                  }}
                  canEdit={canDelete}
                />
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function TodaySalesPage() {
  return (
    <ToastProvider>
      <TodaySalesPageInner />
    </ToastProvider>
  );
}
