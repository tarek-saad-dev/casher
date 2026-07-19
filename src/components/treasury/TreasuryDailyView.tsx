'use client';

/**
 * TreasuryDailyView — shared view for /treasury/daily (admin) and /cashier/treasury/daily (cashier).
 *
 * Cashier view is read-only.
 * Scope can be tightened to current user/shift if needed by passing userId filter.
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Lock, Calculator, ArrowRightLeft, TrendingUp, TrendingDown } from 'lucide-react';
import TreasuryFiltersBar from '@/components/treasury/TreasuryFiltersBar';
import TreasuryKpiCards from '@/components/treasury/TreasuryKpiCards';
import TreasuryHoldBreakdown from '@/components/treasury/TreasuryHoldBreakdown';
import PaymentMethodBreakdownTable from '@/components/treasury/PaymentMethodBreakdownTable';
import TreasuryMovementsTable from '@/components/treasury/TreasuryMovementsTable';
import TreasuryClosePanel from '@/components/treasury/TreasuryClosePanel';
import FinancialClassificationPanel from '@/components/reports/FinancialClassificationPanel';
import PaymentMethodDetailsModal from '@/components/treasury/PaymentMethodDetailsModal';
import PaymentTransferModal from '@/components/treasury/PaymentTransferModal';
import PastDateTransferModal from '@/components/treasury/PastDateTransferModal';
import PastDateIncomeModal from '@/components/treasury/PastDateIncomeModal';
import PastDateExpenseModal from '@/components/treasury/PastDateExpenseModal';
import type {
  DailyTreasuryData,
  TreasuryMovementsResponse,
  CurrentDayShift,
} from '@/lib/types/treasury';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface TreasuryDailyViewProps {
  canCloseDay?: boolean;
  canTransfer?: boolean;
  canAddPastRevenue?: boolean;
  canAddPastExpense?: boolean;
  canDeleteMove?: boolean;
  pageTitle?: string;
  pageSubtitle?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TreasuryDailyView({
  canCloseDay       = true,
  canTransfer       = true,
  canAddPastRevenue = true,
  canAddPastExpense = true,
  canDeleteMove     = true,
  pageTitle         = 'قفل اليوم / الخزنة اليومية',
  pageSubtitle      = 'متابعة الحركات المالية وقفل اليوم',
}: TreasuryDailyViewProps) {
  const [treasuryData,    setTreasuryData]    = useState<DailyTreasuryData | null>(null);
  const [movementsData,   setMovementsData]   = useState<TreasuryMovementsResponse | null>(null);
  const [currentDayShift, setCurrentDayShift] = useState<CurrentDayShift | null>(null);
  const [loading,         setLoading]         = useState(false);
  const [movementsLoading,setMovementsLoading]= useState(false);
  const [error,           setError]           = useState<string | null>(null);

  const [showClosePanel,      setShowClosePanel]      = useState(false);
  const [showTransferModal,   setShowTransferModal]   = useState(false);
  const [showPastIncomeModal, setShowPastIncomeModal] = useState(false);
  const [showPastExpenseModal,setShowPastExpenseModal]= useState(false);
  const [movementsPage,       setMovementsPage]       = useState(1);
  const [holdReloadSignal,    setHoldReloadSignal]    = useState(0);

  const [detailsModal, setDetailsModal] = useState<{
    paymentMethodKey: string;
    paymentMethodName: string;
  } | null>(null);

  const [filters, setFilters] = useState<{
    newDay: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    shiftMoveId: number | null;
    userId: number | null;
  }>({ newDay: null, dateFrom: null, dateTo: null, shiftMoveId: null, userId: null });

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadCurrentDayShift = async () => {
    try {
      const res = await fetch('/api/treasury/current');
      if (res.ok) {
        const data: CurrentDayShift = await res.json();
        setCurrentDayShift(data);
        if (data.currentDay) {
          setFilters(prev => ({ ...prev, newDay: data.currentDay!.newDay }));
        }
      }
    } catch (err) {
      console.error('Failed to load current day/shift:', err);
    }
  };

  const loadTreasuryData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.newDay       !== null) params.append('newDay',      filters.newDay.toString());
      if (filters.dateFrom)              params.append('dateFrom',    filters.dateFrom);
      if (filters.dateTo)                params.append('dateTo',      filters.dateTo);
      if (filters.shiftMoveId  !== null) params.append('shiftMoveId', filters.shiftMoveId.toString());
      if (filters.userId       !== null) params.append('userId',      filters.userId.toString());

      const res = await fetch(`/api/treasury/daily-summary?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'فشل تحميل بيانات الخزنة');
      }
      setTreasuryData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadMovements = useCallback(async (page: number) => {
    setMovementsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.newDay       !== null) params.append('newDay',      filters.newDay.toString());
      if (filters.dateFrom)              params.append('dateFrom',    filters.dateFrom);
      if (filters.dateTo)                params.append('dateTo',      filters.dateTo);
      if (filters.shiftMoveId  !== null) params.append('shiftMoveId', filters.shiftMoveId.toString());
      if (filters.userId       !== null) params.append('userId',      filters.userId.toString());
      params.append('page',     page.toString());
      params.append('pageSize', '50');

      const res = await fetch(`/api/treasury/movements?${params}`);
      if (res.ok) setMovementsData(await res.json());
    } catch (err) {
      console.error('Failed to load movements:', err);
    } finally {
      setMovementsLoading(false);
    }
  }, [filters]);

  useEffect(() => { loadCurrentDayShift(); }, []);

  useEffect(() => {
    if (filters.newDay !== null || filters.dateFrom !== null) {
      loadTreasuryData();
      loadMovements(1);
    }
  }, [filters, loadTreasuryData, loadMovements]);

  useEffect(() => {
    if (filters.newDay !== null || filters.dateFrom !== null) {
      loadMovements(movementsPage);
    }
  }, [movementsPage, filters.newDay, filters.dateFrom, loadMovements]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleFilterChange = (newFilters: typeof filters) => {
    setFilters(newFilters);
    setMovementsPage(1);
  };

  const handleReload = () => {
    loadTreasuryData();
    loadMovements(movementsPage);
    setHoldReloadSignal((s) => s + 1);
  };

  const hasAdminActions =
    (canCloseDay || canTransfer || canAddPastRevenue || canAddPastExpense) &&
    treasuryData &&
    treasuryData.paymentMethods.length > 0;

  const fmt = (n: number) =>
    new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">{pageTitle}</h1>
            <p className="text-zinc-400 text-sm sm:text-base">{pageSubtitle}</p>
          </div>

          {/* Admin-only action buttons */}
          {hasAdminActions && (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {canAddPastRevenue && (
                <button
                  onClick={() => setShowPastIncomeModal(true)}
                  className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs sm:text-sm font-medium hover:bg-emerald-500/30 transition-colors"
                >
                  <TrendingUp className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
                  <span className="hidden sm:inline">اضافه ايراد في يوم سابق</span>
                  <span className="sm:hidden">اضافه ايراد</span>
                </button>
              )}
              {canAddPastExpense && (
                <button
                  onClick={() => setShowPastExpenseModal(true)}
                  className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs sm:text-sm font-medium hover:bg-rose-500/30 transition-colors"
                >
                  <TrendingDown className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
                  <span className="hidden sm:inline">اضافه مصروف في يوم سابق</span>
                  <span className="sm:hidden">اضافه مصروف</span>
                </button>
              )}
              {canTransfer && (
                <button
                  onClick={() => setShowTransferModal(true)}
                  className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-xl text-xs sm:text-sm font-medium hover:bg-cyan-500/30 transition-colors"
                >
                  <ArrowRightLeft className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
                  <span className="hidden sm:inline">تحويل في يوم سابق</span>
                  <span className="sm:hidden">تحويل</span>
                </button>
              )}
              {canCloseDay && (
                <button
                  onClick={() => setShowClosePanel(true)}
                  className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl text-xs sm:text-sm font-medium hover:bg-amber-500/30 transition-colors"
                >
                  <Lock className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
                  <span className="hidden sm:inline">قفل اليوم</span>
                  <span className="sm:hidden">قفل</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Filters ── */}
        <TreasuryFiltersBar
          onFilterChange={handleFilterChange}
          currentDay={currentDayShift?.currentDay || null}
          currentShift={currentDayShift?.currentShift || null}
        />

        {/* ── Error ── */}
        {error && (
          <div className="bg-gradient-to-br from-rose-950/20 to-red-950/10 border border-rose-500/20 rounded-2xl p-6">
            <p className="text-rose-400">{error}</p>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && !treasuryData && (
          <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-12">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-amber-500/60" />
              <p className="text-zinc-400">جاري تحميل بيانات الخزنة...</p>
            </div>
          </div>
        )}

        {/* ── Content ── */}
        {!loading && treasuryData && (
          <>
            {/* Total Money Banner */}
            {(() => {
              const totalNet = treasuryData.paymentMethods.reduce((s, p) => s + p.net, 0);
              return (
                <div className={`rounded-xl sm:rounded-2xl border p-3 sm:p-5 shadow-lg ${totalNet >= 0
                  ? 'bg-gradient-to-l from-emerald-950/40 to-emerald-900/20 border-emerald-500/20'
                  : 'bg-gradient-to-l from-rose-950/40 to-rose-900/20 border-rose-500/20'}`}>
                  <div className="flex flex-col gap-3 sm:gap-4">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className={`p-2 sm:p-3 rounded-xl ${totalNet >= 0 ? 'bg-emerald-500/15' : 'bg-rose-500/15'}`}>
                        <Calculator className={`h-5 sm:h-6 w-5 sm:w-6 ${totalNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} />
                      </div>
                      <div>
                        <p className={`text-xs font-semibold tracking-wide ${totalNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          إجمالي المبلغ في الخزنة
                        </p>
                        <p className="text-[10px] sm:text-xs text-zinc-500 mt-0.5">جمع صافي كل طرق الدفع للفترة المحددة</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-center sm:justify-end gap-3 sm:gap-5">
                      {treasuryData.paymentMethods.map((pm) => (
                        <div key={pm.paymentMethodId} className="text-center min-w-[50px] sm:min-w-[60px]">
                          <p className="text-[10px] sm:text-[11px] text-zinc-500 mb-0.5 truncate max-w-[70px] sm:max-w-[80px]">{pm.paymentMethodName}</p>
                          <p className={`text-xs sm:text-sm font-bold ${pm.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {fmt(pm.net)}<span className="text-[9px] sm:text-[10px] font-normal mr-0.5">ج.م</span>
                          </p>
                        </div>
                      ))}
                      <div className={`h-6 sm:h-8 w-px hidden sm:block ${totalNet >= 0 ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`} />
                      <div className="text-center w-full sm:w-auto mt-2 sm:mt-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-zinc-700/30">
                        <p className={`text-[10px] sm:text-[11px] font-medium mb-0.5 ${totalNet >= 0 ? 'text-emerald-400/70' : 'text-rose-400/70'}`}>الإجمالي</p>
                        <p className={`text-xl sm:text-2xl font-bold ${totalNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {fmt(totalNet)}<span className="text-xs sm:text-sm font-normal mr-1">ج.م</span>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            <TreasuryHoldBreakdown filters={filters} reloadSignal={holdReloadSignal} />

            <TreasuryKpiCards summary={treasuryData.summary} loading={loading} />

            <FinancialClassificationPanel
              payload={treasuryData}
              loading={loading}
              variant="treasury"
              showCleanNetProfit={false}
            />

            <PaymentMethodBreakdownTable
              paymentMethods={treasuryData.paymentMethods}
              loading={loading}
              onViewDetails={(key, name) => setDetailsModal({ paymentMethodKey: key, paymentMethodName: name })}
            />

            {movementsData && (
              <TreasuryMovementsTable
                movements={movementsData.movements}
                pagination={movementsData.pagination}
                loading={movementsLoading}
                onPageChange={setMovementsPage}
              />
            )}
          </>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && !treasuryData && filters.newDay === null && (
          <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-12">
            <div className="flex flex-col items-center justify-center gap-4">
              <div className="p-4 bg-zinc-800/40 rounded-full">
                <Lock className="h-12 w-12 text-zinc-600" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold mb-2 text-white">اختر يوم لعرض البيانات</h3>
                <p className="text-sm text-zinc-400">استخدم الفلاتر أعلاه لاختيار اليوم أو الفترة المطلوبة</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ── */}

      {detailsModal && (
        <PaymentMethodDetailsModal
          paymentMethodKey={detailsModal.paymentMethodKey}
          paymentMethodName={detailsModal.paymentMethodName}
          filters={filters}
          onClose={() => setDetailsModal(null)}
          canDelete={canDeleteMove}
        />
      )}

      {canAddPastRevenue && showPastIncomeModal && (
        <PastDateIncomeModal
          isOpen={showPastIncomeModal}
          onClose={() => setShowPastIncomeModal(false)}
          onIncomeComplete={handleReload}
          defaultDate={filters.dateTo || undefined}
        />
      )}

      {canAddPastExpense && showPastExpenseModal && (
        <PastDateExpenseModal
          isOpen={showPastExpenseModal}
          onClose={() => setShowPastExpenseModal(false)}
          onExpenseComplete={handleReload}
          defaultDate={filters.dateTo || undefined}
        />
      )}

      {canTransfer && showTransferModal && (
        <PastDateTransferModal
          isOpen={showTransferModal}
          onClose={() => setShowTransferModal(false)}
          onTransferComplete={() => { handleReload(); setShowTransferModal(false); }}
          defaultDate={filters.dateTo || undefined}
        />
      )}

      {canCloseDay && showClosePanel && treasuryData && (
        <TreasuryClosePanel
          paymentMethods={treasuryData.paymentMethods}
          newDay={filters.newDay!}
          shiftMoveId={filters.shiftMoveId || undefined}
          onClose={() => setShowClosePanel(false)}
          onSaved={handleReload}
        />
      )}
    </div>
  );
}
