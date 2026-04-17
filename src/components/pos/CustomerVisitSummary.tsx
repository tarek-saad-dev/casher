import { TrendingUp, Calendar, DollarSign, Repeat, Users } from 'lucide-react';

interface VisitSummary {
  totalVisits: number;
  avgVisitGapDays: number | null;
  daysSinceLastVisit: number | null;
  avgSpend: number;
  mostRepeatedService: string | null;
  mostRepeatedServiceCount: number;
  visitPattern: 'regular' | 'overdue' | 'returning' | 'new' | 'insufficient_data';
}

interface CustomerVisitSummaryProps {
  summary: VisitSummary;
}

export default function CustomerVisitSummary({ summary }: CustomerVisitSummaryProps) {
  const getPatternLabel = () => {
    switch (summary.visitPattern) {
      case 'regular':
        return { text: 'عميل منتظم', color: 'text-emerald-500' };
      case 'overdue':
        return { text: 'متأخر عن موعده', color: 'text-orange-500' };
      case 'returning':
        return { text: 'عميل راجع بعد غياب', color: 'text-blue-500' };
      case 'new':
        return { text: 'عميل جديد', color: 'text-purple-500' };
      default:
        return { text: 'بيانات غير كافية', color: 'text-muted-foreground' };
    }
  };

  const pattern = getPatternLabel();

  return (
    <div className="p-3 rounded-lg border border-border bg-card space-y-2.5" dir="rtl">
      <h4 className="text-xs font-bold text-muted-foreground mb-2">ملخص العميل</h4>

      {/* Visit Pattern Badge */}
      <div className="flex items-center gap-2">
        <Users className="w-3.5 h-3.5 text-muted-foreground" />
        <span className={`text-xs font-bold ${pattern.color}`}>{pattern.text}</span>
      </div>

      {/* Visit Frequency */}
      {summary.avgVisitGapDays !== null && (
        <div className="flex items-center gap-2 text-xs">
          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
          <span>بيزورنا كل <span className="font-bold">{summary.avgVisitGapDays}</span> يوم تقريبًا</span>
        </div>
      )}

      {/* Last Visit Recency */}
      {summary.daysSinceLastVisit !== null && (
        <div className="flex items-center gap-2 text-xs">
          <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
          <span>آخر زيارة كانت منذ <span className="font-bold">{summary.daysSinceLastVisit}</span> يوم</span>
        </div>
      )}

      {/* Average Spend */}
      {summary.avgSpend > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
          <span>متوسط صرفه <span className="font-bold">{summary.avgSpend.toLocaleString('ar-EG')}</span> جنيه</span>
        </div>
      )}

      {/* Most Repeated Service */}
      {summary.mostRepeatedService && (
        <div className="flex items-center gap-2 text-xs">
          <Repeat className="w-3.5 h-3.5 text-muted-foreground" />
          <span>أكثر خدمة متكررة: <span className="font-bold">{summary.mostRepeatedService}</span></span>
        </div>
      )}

      {/* Total Visits */}
      <div className="pt-2 border-t border-border">
        <span className="text-[10px] text-muted-foreground">
          إجمالي الزيارات: {summary.totalVisits}
        </span>
      </div>
    </div>
  );
}
