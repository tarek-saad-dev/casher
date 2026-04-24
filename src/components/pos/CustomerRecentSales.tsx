import { Clock, Calendar, CreditCard } from 'lucide-react';

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

interface CustomerRecentSalesProps {
  sales: RecentSale[];
}

export default function CustomerRecentSales({ sales }: CustomerRecentSalesProps) {
  if (sales.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground text-xs">
        لا توجد مبيعات سابقة
      </div>
    );
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      const hour = parseInt(parts[0]);
      const min = parts[1];
      const ampm = hour >= 12 ? 'م' : 'ص';
      const hour12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      return `${hour12}:${min} ${ampm}`;
    }
    return timeStr;
  };

  const getDaysAgoText = (days: number) => {
    if (days === 0) return 'اليوم';
    if (days === 1) return 'أمس';
    if (days === 2) return 'منذ يومين';
    return `منذ ${days} يوم`;
  };

  const getPaymentStyle = (method: string | null | undefined) => {
    if (!method) return { bg: 'bg-muted', text: 'text-muted-foreground', icon: '❓' };
    const m = method.toLowerCase();
    if (m.includes('نقد') || m.includes('cash'))      return { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', icon: '💵' };
    if (m.includes('فيزا') || m.includes('visa'))    return { bg: 'bg-blue-500/10',    text: 'text-blue-600 dark:text-blue-400',    icon: '💳' };
    if (m.includes('انستا') || m.includes('insta')) return { bg: 'bg-purple-500/10', text: 'text-purple-600 dark:text-purple-400', icon: '📱' };
    if (m.includes('تيلدا') || m.includes('tilda')) return { bg: 'bg-orange-500/10', text: 'text-orange-600 dark:text-orange-400', icon: '📲' };
    if (m.includes('فودافون') || m.includes('vodafone')) return { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', icon: '📶' };
    return { bg: 'bg-muted', text: 'text-muted-foreground', icon: '💳' };
  };

  return (
    <div className="space-y-2" dir="rtl">
      {sales.map((sale) => (
        <div
          key={sale.invID}
          className="p-3 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors"
        >
          {/* Header: Date, Time, Amount */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Calendar className="w-3 h-3" />
                <span>{formatDate(sale.invDate)}</span>
              </div>
              {sale.invTime && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>{formatTime(sale.invTime)}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 font-bold text-sm">
              <span>{sale.grandTotal.toLocaleString('ar-EG')}</span>
              <span className="text-xs text-muted-foreground">ج.م</span>
            </div>
          </div>

          {/* Services */}
          <div className="space-y-1">
            {sale.services.map((svc, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs">
                <span className="font-medium">{svc.serviceName}</span>
                {svc.barberName && (
                  <span className="text-muted-foreground text-[10px]">{svc.barberName}</span>
                )}
              </div>
            ))}
          </div>

          {/* Footer: days ago + payment method */}
          <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {getDaysAgoText(sale.daysAgo)}
            </span>
            {sale.paymentMethod && (() => {
              const style = getPaymentStyle(sale.paymentMethod);
              return (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${style.bg} ${style.text}`}>
                  <span>{style.icon}</span>
                  {sale.paymentMethod}
                </span>
              );
            })()}
          </div>
        </div>
      ))}
    </div>
  );
}
