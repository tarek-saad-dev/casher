'use client';

import { useEffect, useState, useRef } from 'react';
import { History, AlertCircle, Wand2 } from 'lucide-react';
import CustomerRecentSales from './CustomerRecentSales';
import CustomerVisitSummary from './CustomerVisitSummary';
import CustomerRecommendation from './CustomerRecommendation';
import CustomerHistorySkeleton from './CustomerHistorySkeleton';

interface SaleDetail {
  serviceName: string;
  barberName: string | null;
}

interface RecentSale {
  invID: number;
  invDate: string;
  invTime: string;
  grandTotal: number;
  daysAgo: number;
  services: SaleDetail[];
  paymentMethod?: string | null;
}

interface VisitSummary {
  totalVisits: number;
  avgVisitGapDays: number | null;
  daysSinceLastVisit: number | null;
  avgSpend: number;
  mostRepeatedService: string | null;
  mostRepeatedServiceCount: number;
  visitPattern: 'regular' | 'overdue' | 'returning' | 'new' | 'insufficient_data';
}

interface Recommendation {
  type: 'maintenance' | 'winback' | 'premium' | 'repeat_service' | 'welcome';
  message: string;
  priority: 'high' | 'medium' | 'low';
}

interface AutoFillService {
  proID: number;
  proName: string;
  empID: number;
  empName: string;
  sPrice: number;
  bonus: number;
}

export interface LastSaleAutoFill {
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  barberEmpID: number | null;
  barberName: string | null;
  services: AutoFillService[];
}

interface CustomerHistoryData {
  customerID: number;
  customerName: string;
  customerPhone: string;
  recentSales: RecentSale[];
  lastSaleForAutoFill: LastSaleAutoFill | null;
  summary: VisitSummary;
  recommendation: Recommendation;
}

interface CustomerHistoryPanelProps {
  customerID: number | null;
  onAutoFill?: (data: LastSaleAutoFill) => void;
}

export default function CustomerHistoryPanel({ customerID, onAutoFill }: CustomerHistoryPanelProps) {
  const [data, setData] = useState<CustomerHistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Reset state when customer changes
    if (!customerID) {
      setData(null);
      setError(null);
      return;
    }

    // Cancel previous request if customer changes quickly
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const loadHistory = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/customers/${customerID}/history-summary`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'فشل تحميل بيانات العميل');
        }

        const historyData = await res.json();
        setData(historyData);
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (err.name === 'AbortError') {
            // Request was cancelled, ignore
            return;
          }
          setError(err.message);
        } else {
          setError('خطأ في تحميل بيانات العميل');
        }
      } finally {
        setLoading(false);
      }
    };

    loadHistory();

    // Cleanup on unmount or customer change
    return () => {
      controller.abort();
    };
  }, [customerID]);

  // Don't render anything if no customer selected
  if (!customerID) {
    return null;
  }

  return (
    <div className="space-y-3" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <History className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-bold">آخر زيارات العميل</h3>
      </div>

      {/* Loading State */}
      {loading && <CustomerHistorySkeleton />}

      {/* Error State */}
      {error && !loading && (
        <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-xs">{error}</span>
          </div>
        </div>
      )}

      {/* Data Display */}
      {data && !loading && !error && (
        <>
          {/* Auto-fill button */}
          {data.lastSaleForAutoFill && onAutoFill && (
            <button
              onClick={() => onAutoFill(data.lastSaleForAutoFill!)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-primary/30 bg-primary/5 text-primary text-xs font-semibold hover:bg-primary/15 transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5" />
              تطبيق آخر زيارة تلقائياً
              {data.lastSaleForAutoFill.barberName && (
                <span className="text-[10px] text-muted-foreground font-normal">({data.lastSaleForAutoFill.barberName})</span>
              )}
            </button>
          )}

          {/* Recent Sales */}
          <div>
            <h4 className="text-xs font-bold text-muted-foreground mb-2">آخر 3 مبيعات</h4>
            <CustomerRecentSales sales={data.recentSales} />
          </div>

          {/* Visit Summary */}
          <CustomerVisitSummary summary={data.summary} />

          {/* Recommendation */}
          <CustomerRecommendation recommendation={data.recommendation} />
        </>
      )}
    </div>
  );
}
