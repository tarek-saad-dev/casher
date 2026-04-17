'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Loader2, CalendarDays, TrendingUp, Target,
  DollarSign, ChevronLeft, AlertTriangle, CheckCircle2, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { BudgetMonth } from '@/lib/types';

const MONTH_NAMES = [
  '', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft:  { label: 'مسودة', color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30' },
  active: { label: 'نشطة', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' },
  closed: { label: 'مغلقة', color: 'bg-muted text-muted-foreground border-border' },
};

export default function BudgetListPage() {
  const router = useRouter();
  const [budgets, setBudgets] = useState<BudgetMonth[]>([]);
  const [loading, setLoading] = useState(true);

  // Set page title
  useEffect(() => {
    document.title = 'الميزانية | نظام نقاط البيع';
  }, []);

  // ──── Create form state ────
  const [showCreate, setShowCreate] = useState(false);
  const now = new Date();
  const [newYear, setNewYear] = useState(now.getFullYear());
  const [newMonth, setNewMonth] = useState(now.getMonth() + 1);
  const [newTargetNetProfit, setNewTargetNetProfit] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const loadBudgets = useCallback(() => {
    setLoading(true);
    fetch('/api/budget')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setBudgets(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadBudgets(); }, [loadBudgets]);

  const handleCreate = async () => {
    setCreateError('');
    if (!newYear || !newMonth) { setCreateError('يجب تحديد سنة وشهر'); return; }
    const targetNP = parseFloat(newTargetNetProfit) || 0;
    if (targetNP <= 0) { setCreateError('يجب تحديد هدف صافي ربح'); return; }

    setCreating(true);
    try {
      const res = await fetch('/api/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: newYear,
          month: newMonth,
          targetNetProfit: targetNP,
          notes: newNotes,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setCreateError(data.error || 'خطأ في إنشاء الميزانية');
        return;
      }
      const result = await res.json();
      router.push(`/budget/${result.BudgetMonthID}`);
    } catch {
      setCreateError('خطأ في الاتصال بالخادم');
    } finally {
      setCreating(false);
    }
  };

  // Summary across all budgets
  const totalTargetNP = budgets.reduce((s, b) => s + ((b.TargetNetProfit as number) || 0), 0);
  const totalApproxNet = budgets.reduce((s, b) => s + ((b.ApproxCurrentNet as number) || 0), 0);
  const activeBudgets = budgets.filter(b => b.Status === 'active').length;

  return (
    <div className="flex flex-col h-full overflow-hidden" dir="rtl">
      {/* Summary Bar */}
      <div className="p-4 border-b border-border bg-muted/10">
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg border border-border p-3 bg-card">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <CalendarDays className="w-4 h-4" />
              <span className="text-xs font-medium">إجمالي الخطط</span>
            </div>
            <p className="text-xl font-black">{budgets.length}</p>
            <p className="text-xs text-muted-foreground">{activeBudgets} نشطة</p>
          </div>
          <div className="rounded-lg border border-border p-3 bg-card">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Target className="w-4 h-4" />
              <span className="text-xs font-medium">هدف صافي الربح</span>
            </div>
            <p className="text-xl font-bold">{totalTargetNP.toLocaleString('ar-EG')} ج.م</p>
          </div>
          <div className="rounded-lg border border-border p-3 bg-card">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <DollarSign className="w-4 h-4" />
              <span className="text-xs font-medium">صافي الربح التقريبي</span>
            </div>
            <p className="text-xl font-bold">{totalApproxNet.toLocaleString('ar-EG')} ج.م</p>
          </div>
          <div className="rounded-lg border border-border p-3 bg-card">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs font-medium">نسبة الإنجاز</span>
            </div>
            <p className={`text-xl font-bold ${
              totalTargetNP > 0 && totalApproxNet >= totalTargetNP ? 'text-emerald-500' :
              totalTargetNP > 0 && totalApproxNet >= totalTargetNP * 0.7 ? 'text-yellow-500' :
              'text-muted-foreground'
            }`}>
              {totalTargetNP > 0 ? Math.round((totalApproxNet / totalTargetNP) * 100) : 0}%
            </p>
          </div>
        </div>
      </div>

      {/* Header + Create Button */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-bold">الميزانيات الشهرية</h2>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-4 h-4 ml-1.5" />
          إنشاء ميزانية جديدة
        </Button>
      </div>

      {/* Create Form (collapsible) */}
      {showCreate && (
        <div className="px-4 py-4 border-b border-border bg-muted/10 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">السنة</label>
              <Input
                type="number" min="2024" max="2030" value={newYear}
                onChange={(e) => setNewYear(parseInt(e.target.value))}
                className="h-9 text-sm" dir="ltr"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">الشهر</label>
              <select
                value={newMonth}
                onChange={(e) => setNewMonth(parseInt(e.target.value))}
                className="w-full h-9 rounded-md border border-border bg-background text-sm px-2"
              >
                {MONTH_NAMES.slice(1).map((name, i) => (
                  <option key={i + 1} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">هدف صافي الربح (ج.م) *</label>
              <Input
                type="number" min="0" placeholder="مثال: 20000" value={newTargetNetProfit}
                onChange={(e) => setNewTargetNetProfit(e.target.value)}
                className="h-9 text-sm" dir="ltr"
              />
              <p className="text-[10px] text-muted-foreground mt-1">الهدف الأساسي — سيتم حساب الإيراد المطلوب تلقائيًا</p>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">ملاحظات</label>
            <Input
              placeholder="ملاحظات اختيارية..."
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          {createError && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-2 font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {createError}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="w-4 h-4 ml-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 ml-1.5" />}
              {creating ? 'جاري الإنشاء...' : 'إنشاء'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowCreate(false); setCreateError(''); }}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {/* Budget Months List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {loading && (
            <div className="text-center py-12 text-muted-foreground">
              <Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" />
              جاري التحميل...
            </div>
          )}

          {!loading && budgets.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">لا توجد ميزانيات بعد</p>
              <p className="text-xs mt-1">أنشئ أول ميزانية شهرية باستخدام الزر أعلاه</p>
            </div>
          )}

          {!loading && budgets.map((b) => {
            const status = STATUS_MAP[b.Status] || STATUS_MAP.draft;
            const targetNP = (b.TargetNetProfit as number) || 0;
            const approxNet = (b.ApproxCurrentNet as number) || 0;
            const achievementPct = (b.AchievementPct as number) || 0;
            const derivedRev = (b.DerivedTargetRevenue as number) || 0;
            const actualRev = (b.ActualRevenue as number) || 0;

            return (
              <div
                key={b.BudgetMonthID}
                className="flex items-center justify-between p-4 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors cursor-pointer"
                onClick={() => router.push(`/budget/${b.BudgetMonthID}`)}
              >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  {/* Month Badge */}
                  <div className="flex flex-col items-center justify-center w-14 h-14 rounded-lg bg-primary/10 text-primary shrink-0">
                    <span className="text-lg font-black leading-none">{b.Month}</span>
                    <span className="text-[10px] font-medium">{b.Year}</span>
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base font-bold">
                        {MONTH_NAMES[b.Month]} {b.Year}
                      </span>
                      <Badge variant="outline" className={`text-[10px] h-5 ${status.color}`}>
                        {status.label}
                      </Badge>
                      {(b.LineCount ?? 0) > 0 && (
                        <span className="text-[10px] text-muted-foreground">{b.LineCount} بند</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>هدف: {targetNP.toLocaleString('ar-EG')} ج.م</span>
                      {derivedRev > 0 && (
                        <span>إيراد مطلوب: {derivedRev.toLocaleString('ar-EG')} ج.م</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Net Profit Achievement */}
                <div className="flex items-center gap-6 shrink-0">
                  <div className="text-left">
                    <p className="text-[10px] text-muted-foreground mb-0.5">صافي الربح</p>
                    <p className="text-sm font-bold">{approxNet.toLocaleString('ar-EG')}</p>
                  </div>
                  <div className="text-left">
                    <p className="text-[10px] text-muted-foreground mb-0.5">الإيراد</p>
                    <p className="text-sm font-bold">{actualRev.toLocaleString('ar-EG')}</p>
                  </div>
                  <div className="text-left min-w-[70px]">
                    <p className="text-[10px] text-muted-foreground mb-0.5">نسبة الإنجاز</p>
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            achievementPct >= 100 ? 'bg-emerald-500' : achievementPct >= 70 ? 'bg-yellow-500' : 'bg-destructive'
                          }`}
                          style={{ width: `${Math.min(Math.max(achievementPct, 0), 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs font-bold ${
                        achievementPct >= 100 ? 'text-emerald-500' : achievementPct >= 70 ? 'text-yellow-500' : 'text-destructive'
                      }`}>
                        {achievementPct}%
                      </span>
                    </div>
                  </div>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
