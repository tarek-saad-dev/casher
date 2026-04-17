'use client';

import { useEffect, useState, useCallback } from 'react';
import { Calendar, Loader2, RotateCcw, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TodaySalesKpiCards from '@/components/sales/TodaySalesKpiCards';
import ByShiftView from '@/components/sales/ByShiftView';
import ByPaymentMethodView from '@/components/sales/ByPaymentMethodView';
import ByBarberView from '@/components/sales/ByBarberView';
import ByServiceView from '@/components/sales/ByServiceView';
import ByHourView from '@/components/sales/ByHourView';
import TodaySalesTransactionsTable from '@/components/sales/TodaySalesTransactionsTable';
import type { TodaySalesData } from '@/lib/types/today-sales';

type AnalysisMode = 'overview' | 'shift' | 'payment' | 'barber' | 'service' | 'hour';

export default function TodaySalesPage() {
  const [data, setData] = useState<TodaySalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('overview');
  const [selectedDate, setSelectedDate] = useState('');

  // Set page title
  useEffect(() => {
    document.title = 'مبيعات اليوم | نظام نقاط البيع';
  }, []);

  // Load sales data
  const loadSalesData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (selectedDate) params.set('date', selectedDate);

      const response = await fetch(`/api/sales/today?${params.toString()}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || 'فشل تحميل البيانات');
        return;
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error('Error loading today sales:', err);
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    loadSalesData();
  }, [loadSalesData]);

  // Quick date helpers
  const setQuickDate = (type: 'today' | 'yesterday') => {
    const date = new Date();
    if (type === 'yesterday') {
      date.setDate(date.getDate() - 1);
    }
    setSelectedDate(date.toISOString().split('T')[0]);
  };

  const analysisModes: { key: AnalysisMode; label: string }[] = [
    { key: 'overview', label: 'نظرة عامة' },
    { key: 'shift', label: 'حسب الوردية' },
    { key: 'payment', label: 'حسب الدفع' },
    { key: 'barber', label: 'حسب الحلاق' },
    { key: 'service', label: 'حسب الخدمة' },
    { key: 'hour', label: 'حسب الساعة' }
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-zinc-950" dir="rtl">
      {/* Header */}
      <div className="border-b border-zinc-800/50 bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 backdrop-blur-sm">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-black text-white flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-500/20">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                </div>
                مبيعات اليوم
              </h1>
              <p className="text-sm text-zinc-400 mt-1">
                تحليل شامل لمبيعات اليوم من عدة زوايا
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Quick Date Buttons */}
              <Button
                variant={!selectedDate ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedDate('')}
                className="text-sm"
              >
                <Calendar className="w-4 h-4 ml-2" />
                اليوم
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setQuickDate('yesterday')}
                className="text-sm"
              >
                أمس
              </Button>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-1.5 bg-zinc-900/60 border border-zinc-800/50 rounded-lg text-sm text-white"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={loadSalesData}
                disabled={loading}
              >
                <RotateCcw className={`w-4 h-4 ml-2 ${loading ? 'animate-spin' : ''}`} />
                تحديث
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Loading State */}
          {loading && !data && (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mx-auto mb-3" />
                <p className="text-sm text-zinc-400">جاري تحميل البيانات...</p>
              </div>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-center">
              <p className="text-sm text-rose-400">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={loadSalesData}
                className="mt-3"
              >
                إعادة المحاولة
              </Button>
            </div>
          )}

          {/* Data View */}
          {data && !loading && (
            <>
              {/* Date Display */}
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Calendar className="w-4 h-4" />
                <span>
                  البيانات لتاريخ: {new Date(data.date).toLocaleDateString('ar-EG', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </span>
              </div>

              {/* KPI Cards */}
              <TodaySalesKpiCards kpi={data.kpi} />

              {/* Analysis Mode Tabs */}
              <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-xl p-1 flex gap-1">
                {analysisModes.map((mode) => (
                  <button
                    key={mode.key}
                    onClick={() => setAnalysisMode(mode.key)}
                    className={`
                      flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all
                      ${analysisMode === mode.key
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-white'
                      }
                    `}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {/* Analysis View */}
              <div className="bg-zinc-900/20 border border-zinc-800/50 rounded-xl p-6">
                {analysisMode === 'overview' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-bold text-white mb-4">أفضل 3 ورديات</h3>
                      <ByShiftView shifts={data.byShift.slice(0, 3)} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white mb-4">طرق الدفع</h3>
                      <ByPaymentMethodView paymentMethods={data.byPaymentMethod} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white mb-4">أفضل 3 حلاقين</h3>
                      <ByBarberView barbers={data.byBarber.slice(0, 3)} />
                    </div>
                  </div>
                )}

                {analysisMode === 'shift' && (
                  <div>
                    <h3 className="text-lg font-bold text-white mb-4">التحليل حسب الوردية</h3>
                    <ByShiftView shifts={data.byShift} />
                  </div>
                )}

                {analysisMode === 'payment' && (
                  <div>
                    <h3 className="text-lg font-bold text-white mb-4">التحليل حسب طريقة الدفع</h3>
                    <ByPaymentMethodView paymentMethods={data.byPaymentMethod} />
                  </div>
                )}

                {analysisMode === 'barber' && (
                  <div>
                    <h3 className="text-lg font-bold text-white mb-4">التحليل حسب الحلاق</h3>
                    <ByBarberView barbers={data.byBarber} />
                  </div>
                )}

                {analysisMode === 'service' && (
                  <div>
                    <h3 className="text-lg font-bold text-white mb-4">التحليل حسب الخدمة</h3>
                    <ByServiceView services={data.byService} />
                  </div>
                )}

                {analysisMode === 'hour' && (
                  <div>
                    <h3 className="text-lg font-bold text-white mb-4">التحليل حسب الساعة</h3>
                    <ByHourView hourly={data.byHour} />
                  </div>
                )}
              </div>

              {/* Detailed Transactions */}
              <div className="bg-zinc-900/20 border border-zinc-800/50 rounded-xl p-6">
                <h3 className="text-lg font-bold text-white mb-4">تفاصيل المعاملات</h3>
                <TodaySalesTransactionsTable 
                  transactions={data.transactions}
                  onInvoiceClick={(invId) => {
                    // Could navigate to invoice detail page
                    console.log('Invoice clicked:', invId);
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
