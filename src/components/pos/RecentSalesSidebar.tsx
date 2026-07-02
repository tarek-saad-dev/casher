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
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground/60" />
        <span className="mr-2 text-sm text-muted-foreground/60">جاري التحميل...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (sales.length === 0) {
    return (
      <div className="text-center py-8">
        <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground/60">لا توجد عمليات بيع حديثة</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground/80">
            {showMore ? `آخر ${sales.length + moreSales.length} عملية بيع اليوم` : 'آخر 3 عمليات بيع'}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadRecentSales}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground/80"
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
          className="bg-surface-muted/50 rounded-lg border border-border overflow-hidden"
        >
          {/* Main Card */}
          <div className="p-3">
            {/* Header */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <ShoppingCart className="w-4 h-4 text-primary" />
                  <span className="text-sm font-bold text-foreground">
                    فاتورة #{sale.InvNo}
                  </span>
                  <Badge 
                    variant={sale.RemainingAmount > 0 ? "destructive" : "default"}
                    className="text-xs"
                  >
                    {sale.RemainingAmount > 0 ? "غير مكتملة" : "مكتملة"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
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
                <DropdownMenuContent align="end" className="bg-surface-muted border-border">
                  <DropdownMenuItem 
                    onClick={() => onEditSale?.(sale.InvID)}
                    className="text-foreground hover:bg-accent"
                  >
                    <Edit2 className="w-4 h-4 ml-2" />
                    تعديل
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => handleDelete(sale.InvID, sale.InvNo)}
                    className="text-destructive hover:bg-destructive/10"
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
                <User className="w-3 h-3 text-muted-foreground" />
                <span className="text-foreground/80">{sale.ClientName}</span>
                {sale.Phone && (
                  <>
                    <Phone className="w-3 h-3 text-muted-foreground" />
                    <span className="text-muted-foreground">{sale.Phone}</span>
                  </>
                )}
              </div>
            )}

            {/* Services Summary */}
            {sale.ServicesSummary && (
              <div className="flex items-start gap-2 mb-2 text-xs">
                <Scissors className="w-3 h-3 text-muted-foreground mt-0.5" />
                <span className="text-foreground/80 line-clamp-2">
                  {sale.ServicesSummary}
                </span>
                <Badge variant="outline" className="text-xs border-border text-foreground/80">
                  {sale.ServiceCount} خدمات
                </Badge>
              </div>
            )}

            {/* Payment Info */}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="flex items-center gap-2 text-xs">
                <CreditCard className="w-3 h-3 text-muted-foreground" />
                <span className="text-foreground/80">{sale.PaymentMethodName}</span>
              </div>
              <div className="text-left">
                <div className="text-sm font-bold text-primary">
                  {formatCurrency(sale.TotalPrice)}
                </div>
                {sale.Discount > 0 && (
                  <div className="text-xs text-primary">
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
              className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground/80"
            >
              {expandedSale === sale.InvID ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
            </Button>
          </div>

          {/* Expanded Details */}
          {expandedSale === sale.InvID && saleDetails[sale.InvID] && (
            <div className="border-t border-border bg-surface-muted/50 p-3">
              <h4 className="text-xs font-semibold text-foreground/80 mb-2">تفاصيل الخدمات:</h4>
              <div className="space-y-2">
                {saleDetails[sale.InvID].map((detail, index) => (
                  <div key={index} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Scissors className="w-3 h-3 text-muted-foreground" />
                      <span className="text-foreground/80">{detail.ProName}</span>
                      <span className="text-muted-foreground">({detail.EmpName})</span>
                    </div>
                    <div className="text-left">
                      <div className="text-foreground/80">{formatCurrency(detail.SPrice)}</div>
                      {detail.Bonus > 0 && (
                        <div className="text-primary text-xs">عمولة: {formatCurrency(detail.Bonus)}</div>
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
          className="w-full text-xs text-muted-foreground border-border hover:text-foreground/80"
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
          className="bg-surface-muted/30 rounded-lg border border-border/50 overflow-hidden"
        >
          {/* Main Card */}
          <div className="p-3">
            {/* Header */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <ShoppingCart className="w-4 h-4 text-muted-foreground/60" />
                  <span className="text-sm font-bold text-muted-foreground">
                    فاتورة #{sale.InvNo}
                  </span>
                  <Badge 
                    variant={sale.RemainingAmount > 0 ? "destructive" : "default"}
                    className="text-xs"
                  >
                    {sale.RemainingAmount > 0 ? "غير مكتملة" : "مكتملة"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
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
                <DropdownMenuContent align="end" className="bg-surface-muted border-border">
                  <DropdownMenuItem 
                    onClick={() => onEditSale?.(sale.InvID)}
                    className="text-foreground hover:bg-accent"
                  >
                    <Edit2 className="w-4 h-4 ml-2" />
                    تعديل
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => handleDelete(sale.InvID, sale.InvNo)}
                    className="text-destructive hover:bg-destructive/10"
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
                <User className="w-3 h-3 text-muted-foreground/60" />
                <span className="text-muted-foreground">{sale.ClientName}</span>
                {sale.Phone && (
                  <>
                    <Phone className="w-3 h-3 text-muted-foreground/60" />
                    <span className="text-muted-foreground/60">{sale.Phone}</span>
                  </>
                )}
              </div>
            )}

            {/* Services Summary */}
            {sale.ServicesSummary && (
              <div className="flex items-start gap-2 mb-2 text-xs">
                <Scissors className="w-3 h-3 text-muted-foreground/60 mt-0.5" />
                <span className="text-muted-foreground line-clamp-2">
                  {sale.ServicesSummary}
                </span>
                <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                  {sale.ServiceCount} خدمات
                </Badge>
              </div>
            )}

            {/* Payment Info */}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="flex items-center gap-2 text-xs">
                <CreditCard className="w-3 h-3 text-muted-foreground/60" />
                <span className="text-muted-foreground">{sale.PaymentMethodName}</span>
              </div>
              <div className="text-left">
                <div className="text-sm font-bold text-muted-foreground">
                  {formatCurrency(sale.TotalPrice)}
                </div>
                {sale.Discount > 0 && (
                  <div className="text-xs text-muted-foreground/60">
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
              className="w-full mt-2 text-xs text-muted-foreground/60 hover:text-muted-foreground"
            >
              {expandedSale === sale.InvID ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
            </Button>
          </div>

          {/* Expanded Details */}
          {expandedSale === sale.InvID && saleDetails[sale.InvID] && (
            <div className="border-t border-border bg-surface-muted/30 p-3">
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">تفاصيل الخدمات:</h4>
              <div className="space-y-2">
                {saleDetails[sale.InvID].map((detail, index) => (
                  <div key={index} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Scissors className="w-3 h-3 text-muted-foreground/60" />
                      <span className="text-muted-foreground">{detail.ProName}</span>
                      <span className="text-muted-foreground/60">({detail.EmpName})</span>
                    </div>
                    <div className="text-left">
                      <div className="text-muted-foreground">{formatCurrency(detail.SPrice)}</div>
                      {detail.Bonus > 0 && (
                        <div className="text-primary text-xs">عمولة: {formatCurrency(detail.Bonus)}</div>
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
            ${t.type === 'success' ? 'bg-success/10 border-success/40 text-success' : ''}
            ${t.type === 'error'   ? 'bg-destructive/10 border-destructive/40 text-destructive' : ''}
            ${t.type === 'info'    ? 'bg-info/10 border-info/30 text-info' : ''}
          `}>
            <span className="flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
