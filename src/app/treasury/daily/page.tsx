'use client';

import { useState, useEffect } from 'react';
import { Loader2, Lock } from 'lucide-react';
import TreasuryFiltersBar from '@/components/treasury/TreasuryFiltersBar';
import TreasuryKpiCards from '@/components/treasury/TreasuryKpiCards';
import PaymentMethodBreakdownTable from '@/components/treasury/PaymentMethodBreakdownTable';
import TreasuryMovementsTable from '@/components/treasury/TreasuryMovementsTable';
import TreasuryClosePanel from '@/components/treasury/TreasuryClosePanel';
import type { 
  DailyTreasuryData, 
  TreasuryMovementsResponse,
  CurrentDayShift 
} from '@/lib/types/treasury';

export default function DailyTreasuryPage() {
  const [treasuryData, setTreasuryData] = useState<DailyTreasuryData | null>(null);
  const [movementsData, setMovementsData] = useState<TreasuryMovementsResponse | null>(null);
  const [currentDayShift, setCurrentDayShift] = useState<CurrentDayShift | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [showClosePanel, setShowClosePanel] = useState(false);
  const [movementsPage, setMovementsPage] = useState(1);

  // Set page title
  useEffect(() => {
    document.title = 'الخزنة - قفل اليوم | نظام نقاط البيع';
  }, []);
  
  const [filters, setFilters] = useState<{
    newDay: number | null;
    dateFrom: string | null;
    dateTo: string | null;
    shiftMoveId: number | null;
    userId: number | null;
  }>({
    newDay: null,
    dateFrom: null,
    dateTo: null,
    shiftMoveId: null,
    userId: null
  });

  // Load current day/shift on mount
  useEffect(() => {
    loadCurrentDayShift();
  }, []);

  // Load treasury data when filters change
  useEffect(() => {
    if (filters.newDay !== null || filters.dateFrom !== null) {
      loadTreasuryData();
      loadMovements(1);
    }
  }, [filters]);

  // Load movements when page changes
  useEffect(() => {
    if (filters.newDay !== null || filters.dateFrom !== null) {
      loadMovements(movementsPage);
    }
  }, [movementsPage]);

  const loadCurrentDayShift = async () => {
    try {
      const response = await fetch('/api/treasury/current');
      if (response.ok) {
        const data: CurrentDayShift = await response.json();
        setCurrentDayShift(data);
        
        // Set default filter to current day
        if (data.currentDay) {
          setFilters(prev => ({
            ...prev,
            newDay: data.currentDay!.newDay
          }));
        }
      }
    } catch (err) {
      console.error('Failed to load current day/shift:', err);
    }
  };

  const loadTreasuryData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams();
      if (filters.newDay !== null) params.append('newDay', filters.newDay.toString());
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.append('dateTo', filters.dateTo);
      if (filters.shiftMoveId !== null) params.append('shiftMoveId', filters.shiftMoveId.toString());
      if (filters.userId !== null) params.append('userId', filters.userId.toString());
      
      const response = await fetch(`/api/treasury/daily-summary?${params}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'فشل تحميل بيانات الخزنة');
      }
      
      const data: DailyTreasuryData = await response.json();
      setTreasuryData(data);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  const loadMovements = async (page: number) => {
    setMovementsLoading(true);
    
    try {
      const params = new URLSearchParams();
      if (filters.newDay !== null) params.append('newDay', filters.newDay.toString());
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.append('dateTo', filters.dateTo);
      if (filters.shiftMoveId !== null) params.append('shiftMoveId', filters.shiftMoveId.toString());
      if (filters.userId !== null) params.append('userId', filters.userId.toString());
      params.append('page', page.toString());
      params.append('pageSize', '50');
      
      const response = await fetch(`/api/treasury/movements?${params}`);
      
      if (response.ok) {
        const data: TreasuryMovementsResponse = await response.json();
        setMovementsData(data);
      }
      
    } catch (err) {
      console.error('Failed to load movements:', err);
    } finally {
      setMovementsLoading(false);
    }
  };

  const handleFilterChange = (newFilters: typeof filters) => {
    setFilters(newFilters);
    setMovementsPage(1);
  };

  const handlePageChange = (page: number) => {
    setMovementsPage(page);
  };

  const handleCloseSaved = () => {
    // Reload data after closing
    loadTreasuryData();
    loadMovements(movementsPage);
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">قفل اليوم / الخزنة اليومية</h1>
            <p className="text-zinc-400">متابعة الحركات المالية وقفل اليوم</p>
          </div>
          
          {treasuryData && treasuryData.paymentMethods.length > 0 && (
            <button
              onClick={() => setShowClosePanel(true)}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl text-sm font-medium hover:bg-amber-500/30 transition-colors"
            >
              <Lock className="h-4 w-4" />
              قفل اليوم
            </button>
          )}
        </div>

        {/* Filters */}
        <TreasuryFiltersBar
          onFilterChange={handleFilterChange}
          currentDay={currentDayShift?.currentDay || null}
          currentShift={currentDayShift?.currentShift || null}
        />

        {/* Error State */}
        {error && (
          <div className="bg-gradient-to-br from-rose-950/20 to-red-950/10 border border-rose-500/20 rounded-2xl p-6">
            <p className="text-rose-400">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && !treasuryData && (
          <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-12">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-amber-500/60" />
              <p className="text-zinc-400">جاري تحميل بيانات الخزنة...</p>
            </div>
          </div>
        )}

        {/* Content */}
        {!loading && treasuryData && (
          <>
            {/* KPI Cards */}
            <TreasuryKpiCards summary={treasuryData.summary} loading={loading} />

            {/* Payment Method Breakdown */}
            <PaymentMethodBreakdownTable 
              paymentMethods={treasuryData.paymentMethods}
              loading={loading}
            />

            {/* Detailed Movements */}
            {movementsData && (
              <TreasuryMovementsTable
                movements={movementsData.movements}
                pagination={movementsData.pagination}
                loading={movementsLoading}
                onPageChange={handlePageChange}
              />
            )}
          </>
        )}

        {/* No Data State */}
        {!loading && !error && !treasuryData && filters.newDay === null && (
          <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-12">
            <div className="flex flex-col items-center justify-center gap-4">
              <div className="p-4 bg-zinc-800/40 rounded-full">
                <Lock className="h-12 w-12 text-zinc-600" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold mb-2 text-white">اختر يوم لعرض البيانات</h3>
                <p className="text-sm text-zinc-400">
                  استخدم الفلاتر أعلاه لاختيار اليوم أو الفترة المطلوبة
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Close Panel Modal */}
      {showClosePanel && treasuryData && (
        <TreasuryClosePanel
          paymentMethods={treasuryData.paymentMethods}
          newDay={filters.newDay!}
          shiftMoveId={filters.shiftMoveId || undefined}
          onClose={() => setShowClosePanel(false)}
          onSaved={handleCloseSaved}
        />
      )}
    </div>
  );
}
