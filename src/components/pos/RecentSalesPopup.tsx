'use client';

import { useState, useEffect } from 'react';
import { 
  ShoppingCart, Edit2, Trash2, User, Phone, Calendar, 
  CreditCard, Scissors, Clock, MoreVertical, Loader2, X
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

interface RecentSalesPopupProps {
  onEditSale?: (saleId: number) => void;
  onDeleteSale?: (saleId: number) => void;
  onRefresh?: () => void;
}

export default function RecentSalesPopup({ 
  onEditSale, 
  onDeleteSale, 
  onRefresh 
}: RecentSalesPopupProps) {
  const [sales, setSales] = useState<RecentSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isVisible, setIsVisible] = useState(false);
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
    
    // Show popup after 2 seconds of page load
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 2000);
    
    return () => clearTimeout(timer);
  }, []);

  const handleDelete = (saleId: number, invNo: number) => {
    setDeleteTarget({ invId: saleId, invNo });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number) => {
    return `${amount.toLocaleString('ar-EG')} جنيه`;
  };

  if (!isVisible || loading || sales.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 space-y-2" dir="rtl">
      {/* Close Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsVisible(false)}
        className="mb-2 text-zinc-400 hover:text-white"
      >
        <X className="w-4 h-4 ml-1" />
        إغلاق
      </Button>

      {sales.map((sale, index) => (
        <div
          key={sale.InvID}
          className="bg-zinc-900 border border-zinc-700 rounded p-2 shadow-lg min-w-[240px] max-w-[280px] transform transition-all duration-300 hover:scale-101"
          style={{
            animation: `slideInUp 0.5s ease-out ${index * 0.1}s both`,
          }}
        >
          {/* Single Line Content */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <ShoppingCart className="w-3 h-3 text-amber-500 flex-shrink-0" />
              <span className="text-xs font-bold text-white">
                #{sale.InvNo}
              </span>
              {sale.ClientName && (
                <span className="text-xs text-zinc-300 truncate">
                  {sale.ClientName}
                </span>
              )}
              {sale.ServicesSummary && (
                <span className="text-xs text-zinc-400 truncate">
                  {sale.ServicesSummary.split(',')[0]}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="text-left">
                <div className="text-xs font-bold text-amber-500">
                  {formatCurrency(sale.TotalPrice)}
                </div>
                {sale.Discount > 0 && (
                  <div className="text-xs text-amber-400">
                    -{formatCurrency(sale.Discount)}
                  </div>
                )}
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0">
                    <MoreVertical className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-zinc-800 border-zinc-700">
                  <DropdownMenuItem 
                    onClick={() => onEditSale?.(sale.InvID)}
                    className="text-white hover:bg-zinc-700 text-xs"
                  >
                    <Edit2 className="w-3 h-3 ml-1" />
                    تعديل
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => handleDelete(sale.InvID, sale.InvNo)}
                    className="text-rose-400 hover:bg-rose-500/10 text-xs"
                  >
                    <Trash2 className="w-3 h-3 ml-1" />
                    حذف
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      ))}

      {/* Error Display */}
      {error && (
        <div className="bg-rose-900/90 border border-rose-500/40 rounded-xl p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <DeleteInvoiceDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onSuccess={async () => {
          setDeleteTarget(null);
          await loadRecentSales();
          onRefresh?.();
        }}
      />

      {/* Add custom animation styles */}
      <style jsx>{`
        @keyframes slideInUp {
          from {
            opacity: 0;
            transform: translateY(100px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
