'use client';

import { useState, useEffect } from 'react';
import { 
  ShoppingCart, Edit2, Trash2, User, Phone, Calendar, 
  CreditCard, Scissors, Clock, MoreVertical, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
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

interface RecentSalesCardsProps {
  onEditSale?: (saleId: number) => void;
  onDeleteSale?: (saleId: number) => void;
  onRefresh?: () => void;
}

export default function RecentSalesCards({ 
  onEditSale, 
  onDeleteSale, 
  onRefresh 
}: RecentSalesCardsProps) {
  const [sales, setSales] = useState<RecentSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DeleteInvoiceTarget | null>(null);

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

  useEffect(() => {
    loadRecentSales();
  }, []);

  const handleDelete = (saleId: number, invNo: number) => {
    setDeleteTarget({ invId: saleId, invNo });
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">آخر 3 عمليات بيع</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadRecentSales}
          className="h-6 px-2 text-xs text-zinc-400 hover:text-zinc-300"
        >
          <Clock className="w-3 h-3 ml-1" />
          تحديث
        </Button>
      </div>

      {sales.map((sale) => (
        <div
          key={sale.InvID}
          className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700 hover:border-zinc-600 transition-colors"
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-white">
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
              <div className="text-sm font-medium text-white">
                {formatCurrency(sale.TotalPrice)}
              </div>
              {sale.Discount > 0 && (
                <div className="text-xs text-amber-400">
                  خصم: {formatCurrency(sale.Discount)}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      <DeleteInvoiceDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onSuccess={async () => {
          setDeleteTarget(null);
          await loadRecentSales();
          onRefresh?.();
        }}
      />
    </div>
  );
}
