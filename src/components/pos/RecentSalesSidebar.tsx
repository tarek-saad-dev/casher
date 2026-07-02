'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  ShoppingCart, Edit2, Trash2, User, Phone, Calendar, 
  CreditCard, Scissors, Clock, MoreVertical, Loader2, RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import DeleteInvoiceDialog, { type DeleteInvoiceTarget } from '@/components/sales/DeleteInvoiceDialog';

interface RecentSale {
  InvID: number;
  InvNo: number;
  InvDate: string;
  TotalPrice: number;
  PaidAmount: number;
  RemainingAmount: number;
  Discount: number;
  PaymentMethodID: number;
  PaymentMethodName: string;
  ClientID: number | null;
  ClientName: string | null;
  Phone: string | null;
  EmpID: number | null;
  EmpName: string | null;
  ServiceCount: number;
  ServicesSummary: string | null;
}

interface SaleDetail {
  ProID: number;
  ProName: string;
  EmpID: number;
  EmpName: string;
  SPrice: number;
  Qty: number;
  Bonus: number;
}

interface RecentSalesSidebarProps {
  onEditSale?: (saleId: number) => void;
  onDeleteSale?: (saleId: number) => void;
  onRefresh?: () => void;
  showHeader?: boolean;
  refreshToken?: number;
}

export default function RecentSalesSidebar({ 
  onEditSale, 
  onDeleteSale, 
  onRefresh,
  showHeader = true,
  refreshToken,
}: RecentSalesSidebarProps) {
  const [sales, setSales] = useState<RecentSale[]>([]);
  const [moreSales, setMoreSales] = useState<RecentSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [expandedSale, setExpandedSale] = useState<number | null>(null);
  const [saleDetails, setSaleDetails] = useState<{ [key: number]: SaleDetail[] }>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteInvoiceTarget | null>(null);

  // Toast
  const [toasts, setToasts] = useState<{ id: number; type: 'success' | 'error' | 'info'; message: string }[]>([]);
  const toastIdRef = useRef(0);
  const addToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = ++toastIdRef.current;
    setToasts(p => [...p, { id, type, message }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  }, []);

  const loadRecentSales = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/sales/recent');
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'فشل تحميل آخر المبيعات');
      }
      
      setSales(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  const loadMoreSales = async () => {
    setLoadingMore(true);
    try {
      const response = await fetch('/api/sales/more');
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'فشل تحميل المزيد من المبيعات');
      }
      
      setMoreSales(Array.isArray(data) ? data : []);
      setShowMore(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setLoadingMore(false);
    }
  };

  const loadSaleDetails = async (saleId: number) => {
    try {
      const response = await fetch(`/api/sales/${saleId}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'فشل تحميل تفاصيل الفاتورة');
      }
      
      setSaleDetails(prev => ({
        ...prev,
        [saleId]: data.items || []
      }));
    } catch (e: unknown) {
      console.error('Failed to load sale details:', e);
    }
  };

  useEffect(() => {
    loadRecentSales();
  }, []);

  useEffect(() => {
    if (refreshToken !== undefined && refreshToken > 0) {
      loadRecentSales();
    }
  }, [refreshToken]);

  const handleDelete = (saleId: number, invNo: number) => {
    setDeleteTarget({ invId: saleId, invNo });
  };

  const handleExpand = async (saleId: number) => {
    if (expandedSale === saleId) {
      setExpandedSale(null);
    } else {
      setExpandedSale(saleId);
      if (!saleDetails[saleId]) {
        await loadSaleDetails(saleId);
      }
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ar-EG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number) => {
    return `${amount.toLocaleString('ar-EG')} جنيه`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        <span className="mr-2 text-sm text-zinc-500">جاري التحميل...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-rose-500/30 bg-rose-500/5">
        <p className="text-sm text-rose-400">{error}</p>
      </div>
    );
  }

  if (sales.length === 0) {
    return (
      <div className="text-center py-8">
        <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-zinc-600" />
        <p className="text-sm text-zinc-500">لا توجد عمليات بيع حديثة</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-300">
            {showMore ? `آخر ${sales.length + moreSales.length} عملية بيع اليوم` : 'آخر 3 عمليات بيع'}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadRecentSales}
            className="h-6 px-2 text-xs text-zinc-400 hover:text-zinc-300"
          >
            <RefreshCw className="w-3 h-3 ml-1" />
            تحديث
          </Button>
        </div>
      )}

      {/* First 3 sales */}
      {sales.map((sale) => (
        <div
          key={sale.InvID}
          className="bg-zinc-800/50 rounded-lg border border-zinc-700 overflow-hidden"
        >
          {/* Main Card */}
          <div className="p-3">
            {/* Header */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <ShoppingCart className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-bold text-white">
                    فاتورة #{sale.InvNo}
                  </span>
                  <Badge 
                    variant={sale.RemainingAmount > 0 ? "destructive" : "default"}
                    className="text-xs"
                  >
                    {sale.RemainingAmount > 0 ? "غير مكتملة" : "مكتملة"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-zinc-400">
                  <Calendar className="w-3 h-3" />
                  {formatDate(sale.InvDate)}
                </div>
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-zinc-800 border-zinc-700">
                  <DropdownMenuItem 
                    onClick={() => onEditSale?.(sale.InvID)}
                    className="text-white hover:bg-zinc-700"
                  >
                    <Edit2 className="w-4 h-4 ml-2" />
                    تعديل
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => handleDelete(sale.InvID, sale.InvNo)}
                    className="text-rose-400 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-4 h-4 ml-2" />
                    حذف
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Customer Info */}
            {sale.ClientName && (
              <div className="flex items-center gap-2 mb-2 text-xs">
                <User className="w-3 h-3 text-zinc-400" />
                <span className="text-zinc-300">{sale.ClientName}</span>
                {sale.Phone && (
                  <>
                    <Phone className="w-3 h-3 text-zinc-400" />
                    <span className="text-zinc-400">{sale.Phone}</span>
                  </>
                )}
              </div>
            )}

            {/* Services Summary */}
            {sale.ServicesSummary && (
              <div className="flex items-start gap-2 mb-2 text-xs">
                <Scissors className="w-3 h-3 text-zinc-400 mt-0.5" />
                <span className="text-zinc-300 line-clamp-2">
                  {sale.ServicesSummary}
                </span>
                <Badge variant="outline" className="text-xs border-zinc-600 text-zinc-300">
                  {sale.ServiceCount} خدمات
                </Badge>
              </div>
            )}

            {/* Payment Info */}
            <div className="flex items-center justify-between pt-2 border-t border-zinc-700">
              <div className="flex items-center gap-2 text-xs">
                <CreditCard className="w-3 h-3 text-zinc-400" />
                <span className="text-zinc-300">{sale.PaymentMethodName}</span>
              </div>
              <div className="text-left">
                <div className="text-sm font-bold text-amber-500">
                  {formatCurrency(sale.TotalPrice)}
                </div>
                {sale.Discount > 0 && (
                  <div className="text-xs text-amber-400">
                    خصم: {formatCurrency(sale.Discount)}
                  </div>
                )}
              </div>
            </div>

            {/* Expand Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleExpand(sale.InvID)}
              className="w-full mt-2 text-xs text-zinc-400 hover:text-zinc-300"
            >
              {expandedSale === sale.InvID ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
            </Button>
          </div>

          {/* Expanded Details */}
          {expandedSale === sale.InvID && saleDetails[sale.InvID] && (
            <div className="border-t border-zinc-700 bg-zinc-900/50 p-3">
              <h4 className="text-xs font-semibold text-zinc-300 mb-2">تفاصيل الخدمات:</h4>
              <div className="space-y-2">
                {saleDetails[sale.InvID].map((detail, index) => (
                  <div key={index} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Scissors className="w-3 h-3 text-zinc-400" />
                      <span className="text-zinc-300">{detail.ProName}</span>
                      <span className="text-zinc-400">({detail.EmpName})</span>
                    </div>
                    <div className="text-left">
                      <div className="text-zinc-300">{formatCurrency(detail.SPrice)}</div>
                      {detail.Bonus > 0 && (
                        <div className="text-amber-400 text-xs">عمولة: {formatCurrency(detail.Bonus)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* See More Button */}
      {!showMore && sales.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={loadMoreSales}
          disabled={loadingMore}
          className="w-full text-xs text-zinc-400 border-zinc-600 hover:text-zinc-300"
        >
          {loadingMore ? (
            <>
              <Loader2 className="w-3 h-3 ml-1 animate-spin" />
              جاري التحميل...
            </>
          ) : (
            <>
              See More (المزيد)
            </>
          )}
        </Button>
      )}

      {/* Additional Sales (4-6) */}
      {showMore && moreSales.map((sale) => (
        <div
          key={sale.InvID}
          className="bg-zinc-800/30 rounded-lg border border-zinc-700/50 overflow-hidden"
        >
          {/* Main Card */}
          <div className="p-3">
            {/* Header */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <ShoppingCart className="w-4 h-4 text-zinc-500" />
                  <span className="text-sm font-bold text-zinc-400">
                    فاتورة #{sale.InvNo}
                  </span>
                  <Badge 
                    variant={sale.RemainingAmount > 0 ? "destructive" : "default"}
                    className="text-xs"
                  >
                    {sale.RemainingAmount > 0 ? "غير مكتملة" : "مكتملة"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-zinc-500">
                  <Calendar className="w-3 h-3" />
                  {formatDate(sale.InvDate)}
                </div>
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-zinc-800 border-zinc-700">
                  <DropdownMenuItem 
                    onClick={() => onEditSale?.(sale.InvID)}
                    className="text-white hover:bg-zinc-700"
                  >
                    <Edit2 className="w-4 h-4 ml-2" />
                    تعديل
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => handleDelete(sale.InvID, sale.InvNo)}
                    className="text-rose-400 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-4 h-4 ml-2" />
                    حذف
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Customer Info */}
            {sale.ClientName && (
              <div className="flex items-center gap-2 mb-2 text-xs">
                <User className="w-3 h-3 text-zinc-500" />
                <span className="text-zinc-400">{sale.ClientName}</span>
                {sale.Phone && (
                  <>
                    <Phone className="w-3 h-3 text-zinc-500" />
                    <span className="text-zinc-500">{sale.Phone}</span>
                  </>
                )}
              </div>
            )}

            {/* Services Summary */}
            {sale.ServicesSummary && (
              <div className="flex items-start gap-2 mb-2 text-xs">
                <Scissors className="w-3 h-3 text-zinc-500 mt-0.5" />
                <span className="text-zinc-400 line-clamp-2">
                  {sale.ServicesSummary}
                </span>
                <Badge variant="outline" className="text-xs border-zinc-600 text-zinc-400">
                  {sale.ServiceCount} خدمات
                </Badge>
              </div>
            )}

            {/* Payment Info */}
            <div className="flex items-center justify-between pt-2 border-t border-zinc-700">
              <div className="flex items-center gap-2 text-xs">
                <CreditCard className="w-3 h-3 text-zinc-500" />
                <span className="text-zinc-400">{sale.PaymentMethodName}</span>
              </div>
              <div className="text-left">
                <div className="text-sm font-bold text-zinc-400">
                  {formatCurrency(sale.TotalPrice)}
                </div>
                {sale.Discount > 0 && (
                  <div className="text-xs text-zinc-500">
                    خصم: {formatCurrency(sale.Discount)}
                  </div>
                )}
              </div>
            </div>

            {/* Expand Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleExpand(sale.InvID)}
              className="w-full mt-2 text-xs text-zinc-500 hover:text-zinc-400"
            >
              {expandedSale === sale.InvID ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
            </Button>
          </div>

          {/* Expanded Details */}
          {expandedSale === sale.InvID && saleDetails[sale.InvID] && (
            <div className="border-t border-zinc-700 bg-zinc-900/30 p-3">
              <h4 className="text-xs font-semibold text-zinc-400 mb-2">تفاصيل الخدمات:</h4>
              <div className="space-y-2">
                {saleDetails[sale.InvID].map((detail, index) => (
                  <div key={index} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Scissors className="w-3 h-3 text-zinc-500" />
                      <span className="text-zinc-400">{detail.ProName}</span>
                      <span className="text-zinc-500">({detail.EmpName})</span>
                    </div>
                    <div className="text-left">
                      <div className="text-zinc-400">{formatCurrency(detail.SPrice)}</div>
                      {detail.Bonus > 0 && (
                        <div className="text-amber-400 text-xs">عمولة: {formatCurrency(detail.Bonus)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      <DeleteInvoiceDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onSuccess={async () => {
          setDeleteTarget(null);
          addToast('success', 'تم حذف الفاتورة بنجاح');
          await loadRecentSales();
          onRefresh?.();
        }}
      />

      {/* Toast notifications */}
      <div className="fixed bottom-4 left-4 z-[80] flex flex-col gap-2 w-72" dir="rtl">
        {toasts.map(t => (
          <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl text-sm font-medium
            ${t.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300' : ''}
            ${t.type === 'error'   ? 'bg-rose-950/90 border-rose-500/40 text-rose-300' : ''}
            ${t.type === 'info'    ? 'bg-blue-950/90 border-blue-500/30 text-blue-300' : ''}
          `}>
            <span className="flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
