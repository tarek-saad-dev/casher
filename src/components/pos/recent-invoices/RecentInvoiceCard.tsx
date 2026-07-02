'use client';

import { useState } from 'react';
import {
  ShoppingCart,
  Edit2,
  Trash2,
  User,
  Phone,
  Calendar,
  CreditCard,
  Scissors,
  MoreVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import type { RecentInvoiceItem } from '@/lib/recentInvoices.types';

interface SaleDetail {
  ProID: number;
  ProName: string;
  EmpID: number;
  EmpName: string;
  SPrice: number;
  Qty: number;
  Bonus: number;
}

interface RecentInvoiceCardProps {
  sale: RecentInvoiceItem;
  onEditSale?: (saleId: number) => void;
  onDeleteSale?: (saleId: number, invNo: number) => void;
  muted?: boolean;
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString('ar-EG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(amount: number) {
  return `${amount.toLocaleString('ar-EG')} جنيه`;
}

export default function RecentInvoiceCard({
  sale,
  onEditSale,
  onDeleteSale,
  muted = false,
}: RecentInvoiceCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<SaleDetail[] | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const handleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    setExpanded(true);
    if (details) return;

    setLoadingDetails(true);
    try {
      const response = await fetch(`/api/sales/${sale.InvID}`);
      const data = await response.json();
      if (response.ok) {
        setDetails(data.items || []);
      }
    } catch {
      setDetails([]);
    } finally {
      setLoadingDetails(false);
    }
  };

  const titleClass = muted ? 'text-muted-foreground' : 'text-foreground';
  const subTextClass = muted ? 'text-muted-foreground/60' : 'text-muted-foreground';
  const bodyTextClass = muted ? 'text-muted-foreground' : 'text-foreground/80';
  const cardClass = muted
    ? 'bg-surface-muted/30 border-border/50'
    : 'bg-surface-muted/50 border-border';

  return (
    <div className={`overflow-hidden rounded-lg border ${cardClass}`}>
      <div className="p-3">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex-1">
            <div className="mb-1 flex items-center gap-2">
              <ShoppingCart className={`h-4 w-4 ${muted ? 'text-muted-foreground/60' : 'text-primary'}`} />
              <span className={`text-sm font-bold ${titleClass}`}>فاتورة #{sale.InvNo}</span>
              <Badge variant={sale.RemainingAmount > 0 ? 'destructive' : 'default'} className="text-xs">
                {sale.RemainingAmount > 0 ? 'غير مكتملة' : 'مكتملة'}
              </Badge>
            </div>
            <div className={`flex items-center gap-1 text-xs ${subTextClass}`}>
              <Calendar className="h-3 w-3" />
              {formatDate(sale.InvDate)}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[100] border-border bg-surface-muted">
              <DropdownMenuItem
                onClick={() => onEditSale?.(sale.InvID)}
                className="text-foreground hover:bg-accent"
              >
                <Edit2 className="ml-2 h-4 w-4" />
                تعديل
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDeleteSale?.(sale.InvID, sale.InvNo)}
                className="text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="ml-2 h-4 w-4" />
                حذف
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {sale.ClientName && (
          <div className={`mb-2 flex items-center gap-2 text-xs ${bodyTextClass}`}>
            <User className={`h-3 w-3 ${subTextClass}`} />
            <span>{sale.ClientName}</span>
            {sale.Phone && (
              <>
                <Phone className={`h-3 w-3 ${subTextClass}`} />
                <span className={subTextClass}>{sale.Phone}</span>
              </>
            )}
          </div>
        )}

        {sale.ServicesSummary && (
          <div className={`mb-2 flex items-start gap-2 text-xs ${bodyTextClass}`}>
            <Scissors className={`mt-0.5 h-3 w-3 ${subTextClass}`} />
            <span className="line-clamp-2">{sale.ServicesSummary}</span>
            <Badge variant="outline" className={`text-xs ${muted ? 'border-border text-muted-foreground' : 'border-border text-foreground/80'}`}>
              {sale.ServiceCount} خدمات
            </Badge>
          </div>
        )}

        {sale.EmployeeNames && (
          <p className={`mb-2 text-[11px] ${subTextClass}`}>الصنايعي: {sale.EmployeeNames}</p>
        )}

        <div className="flex items-center justify-between border-t border-border pt-2">
          <div className={`flex items-center gap-2 text-xs ${bodyTextClass}`}>
            <CreditCard className={`h-3 w-3 ${subTextClass}`} />
            <span>{sale.PaymentMethodName}</span>
          </div>
          <div className="text-left">
            <div className={`text-sm font-bold ${muted ? 'text-muted-foreground' : 'text-primary'}`}>
              {formatCurrency(sale.TotalPrice)}
            </div>
            {sale.Discount > 0 && (
              <div className={`text-xs ${muted ? 'text-muted-foreground/60' : 'text-primary'}`}>
                خصم: {formatCurrency(sale.Discount)}
              </div>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleExpand}
          className={`mt-2 w-full text-xs ${subTextClass} hover:text-foreground`}
        >
          {expanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
        </Button>
      </div>

      {expanded && (
        <div className={`border-t border-border p-3 ${muted ? 'bg-surface-muted/30' : 'bg-surface-muted/50'}`}>
          <h4 className={`mb-2 text-xs font-semibold ${bodyTextClass}`}>تفاصيل الخدمات:</h4>
          {loadingDetails ? (
            <p className={`text-xs ${subTextClass}`}>جاري التحميل...</p>
          ) : (
            <div className="space-y-2">
              {(details ?? []).map((detail, index) => (
                <div key={`${detail.ProID}-${index}`} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Scissors className={`h-3 w-3 ${subTextClass}`} />
                    <span className={bodyTextClass}>{detail.ProName}</span>
                    <span className={subTextClass}>({detail.EmpName})</span>
                  </div>
                  <div className="text-left">
                    <div className={bodyTextClass}>{formatCurrency(detail.SPrice)}</div>
                    {detail.Bonus > 0 && (
                      <div className="text-xs text-primary">عمولة: {formatCurrency(detail.Bonus)}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
