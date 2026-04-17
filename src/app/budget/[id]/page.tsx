'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Plus, Loader2, AlertTriangle, CheckCircle2, Save,
  Trash2, Pencil, X, Target, TrendingDown,
  ArrowRight, BarChart3, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import type {
  BudgetDashboard, BudgetMonthLine, BudgetLineType, BudgetStatus,
  ExpenseCategory, Barber, SaveBudgetLinePayload,
} from '@/lib/types';

const MONTH_NAMES = [
  '', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const LINE_TYPE_LABELS: Record<BudgetLineType, string> = {
  expense_category: 'فئة مصروفات',
  payroll: 'رواتب',
  utility: 'مرافق',
  subscription: 'اشتراكات',
  advance: 'سلفة',
  non_operating: 'غير تشغيلي',
  target: 'مستهدف',
  other: 'أخرى',
};

const LINE_TYPE_COLORS: Record<BudgetLineType, string> = {
  expense_category: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  payroll: 'bg-purple-500/10 text-purple-500 border-purple-500/30',
  utility: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  subscription: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/30',
  advance: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  non_operating: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
  target: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
  other: 'bg-muted text-muted-foreground border-border',
};

const STATUS_OPTIONS: { value: BudgetStatus; label: string }[] = [
  { value: 'draft', label: 'مسودة' },
  { value: 'active', label: 'نشطة' },
  { value: 'closed', label: 'مغلقة' },
];

const EMPTY_LINE: SaveBudgetLinePayload = {
  lineType: 'expense_category',
  expINID: null,
  empID: null,
  lineName: '',
  plannedAmount: 0,
  warningThresholdPct: 80,
  hardCapAmount: null,
  sortOrder: null,
  notes: '',
  isActive: true,
};

// Using BudgetDashboard type from lib/types

export default function BudgetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const budgetMonthID = parseInt(params.id as string);

  // ──── Data state ────
  const [data, setData] = useState<BudgetDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [employees, setEmployees] = useState<Barber[]>([]);

  // ──── Header edit state ────
  const [editingHeader, setEditingHeader] = useState(false);
  const [hProfit, setHProfit] = useState('');
  const [hStatus, setHStatus] = useState<BudgetStatus>('draft');
  const [hNotes, setHNotes] = useState('');
  const [savingHeader, setSavingHeader] = useState(false);

  // ──── Line form state ────
  const [showLineForm, setShowLineForm] = useState(false);
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [lineForm, setLineForm] = useState<SaveBudgetLinePayload>({ ...EMPTY_LINE });
  const [savingLine, setSavingLine] = useState(false);
  const [lineError, setLineError] = useState('');

  // ──── Load lookups ────
  useEffect(() => {
    fetch('/api/expenses/categories')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setCategories(d); })
      .catch(() => {});
    fetch('/api/barbers')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setEmployees(d); })
      .catch(() => {});
  }, []);

  // ──── Load budget detail ────
  const loadData = useCallback(() => {
    if (isNaN(budgetMonthID)) return;
    setLoading(true);
    fetch(`/api/budget/${budgetMonthID}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setData(null); return; }
        setData(d);
        setHProfit(String(d.TargetNetProfit || ''));
        setHStatus(d.Status || 'draft');
        setHNotes(d.Notes || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [budgetMonthID]);

  useEffect(() => { loadData(); }, [loadData]);

  // ──── Save header ────
  const saveHeader = async () => {
    setSavingHeader(true);
    try {
      await fetch(`/api/budget/${budgetMonthID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetNetProfit: parseFloat(hProfit) || null,
          status: hStatus,
          notes: hNotes,
        }),
      });
      setEditingHeader(false);
      loadData();
    } catch {} finally { setSavingHeader(false); }
  };

  // ──── Add/Edit line ────
  const openAddLine = () => {
    setEditingLineId(null);
    setLineForm({ ...EMPTY_LINE });
    setLineError('');
    setShowLineForm(true);
  };

  const openEditLine = (line: BudgetMonthLine) => {
    setEditingLineId(line.ID);
    setLineForm({
      lineType: line.LineType,
      expINID: line.ExpINID,
      empID: line.EmpID,
      lineName: line.LineName,
      plannedAmount: line.PlannedAmount,
      warningThresholdPct: line.WarningThresholdPct,
      hardCapAmount: line.HardCapAmount,
      sortOrder: line.SortOrder,
      notes: line.Notes || '',
      isActive: line.IsActive,
    });
    setLineError('');
    setShowLineForm(true);
  };

  const saveLine = async () => {
    setLineError('');
    if (!lineForm.lineName.trim()) { setLineError('يجب إدخال اسم البند'); return; }
    if (!lineForm.plannedAmount || lineForm.plannedAmount <= 0) { setLineError('يجب إدخال مبلغ مخطط'); return; }

    setSavingLine(true);
    try {
      const url = editingLineId
        ? `/api/budget/${budgetMonthID}/lines/${editingLineId}`
        : `/api/budget/${budgetMonthID}/lines`;
      const method = editingLineId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lineForm),
      });

      if (!res.ok) {
        const d = await res.json();
        setLineError(d.error || 'خطأ في حفظ البند');
        return;
      }

      setShowLineForm(false);
      loadData();
    } catch {
      setLineError('خطأ في الاتصال');
    } finally { setSavingLine(false); }
  };

  // ──── Delete line ────
  const deleteLine = async (lineId: number) => {
    if (!confirm('هل تريد حذف هذا البند؟')) return;
    try {
      await fetch(`/api/budget/${budgetMonthID}/lines/${lineId}`, { method: 'DELETE' });
      loadData();
    } catch {}
  };

  // ──── Computed summary ────
  const summary = useMemo(() => {
    if (!data) return null;
    const lines = data.lines || [];
    const activeLines = lines.filter(l => l.IsActive);
    const totalPlanned = activeLines.reduce((s, l) => s + l.PlannedAmount, 0);
    const totalActual = data.ActualExpenses || 0;
    const totalRemaining = totalPlanned - totalActual;
    const overCount = activeLines.filter(l => (l.WarningState === 'over')).length;
    const warningCount = activeLines.filter(l => (l.WarningState === 'warning')).length;
    return { totalPlanned, totalActual, totalRemaining, overCount, warningCount, lineCount: activeLines.length };
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" dir="rtl">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" dir="rtl">
        <AlertTriangle className="w-8 h-8 text-destructive" />
        <p className="text-sm font-medium">الميزانية غير موجودة</p>
        <Button size="sm" variant="outline" onClick={() => router.push('/budget')}>
          <ArrowRight className="w-4 h-4 ml-1" /> العودة
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden" dir="rtl">
      {/* ═══════ LEFT: Summary + Header + Line Form ═══════ */}
      <aside className="w-[400px] border-l border-border flex flex-col shrink-0 overflow-y-auto">
        {/* Month Title */}
        <div className="p-4 border-b border-border bg-muted/20">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">
              ميزانية {MONTH_NAMES[data.Month]} {data.Year}
            </h2>
            <Badge variant="outline" className={`text-[10px] ${
              data.Status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' :
              data.Status === 'closed' ? 'bg-muted text-muted-foreground' :
              'bg-yellow-500/10 text-yellow-500 border-yellow-500/30'
            }`}>
              {STATUS_OPTIONS.find(s => s.value === data.Status)?.label}
            </Badge>
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="p-3 border-b border-border grid grid-cols-2 gap-2">
            <div className="rounded-lg border p-2 bg-card">
              <p className="text-[10px] text-muted-foreground">مخطط</p>
              <p className="text-sm font-bold">{summary.totalPlanned.toLocaleString('ar-EG')} ج.م</p>
            </div>
            <div className="rounded-lg border p-2 bg-card">
              <p className="text-[10px] text-muted-foreground">فعلي</p>
              <p className={`text-sm font-bold ${summary.totalActual > summary.totalPlanned ? 'text-destructive' : 'text-emerald-500'}`}>
                {summary.totalActual.toLocaleString('ar-EG')} ج.م
              </p>
            </div>
            <div className="rounded-lg border p-2 bg-card">
              <p className="text-[10px] text-muted-foreground">متبقي</p>
              <p className={`text-sm font-bold ${summary.totalRemaining < 0 ? 'text-destructive' : ''}`}>
                {summary.totalRemaining.toLocaleString('ar-EG')} ج.م
              </p>
            </div>
            <div className="rounded-lg border p-2 bg-card">
              <p className="text-[10px] text-muted-foreground">تجاوز / تحذير</p>
              <p className="text-sm font-bold">
                <span className="text-destructive">{summary.overCount}</span>
                {' / '}
                <span className="text-yellow-500">{summary.warningCount}</span>
              </p>
            </div>
            {data.TargetRevenue != null && data.TargetRevenue > 0 && (
              <div className="rounded-lg border p-2 bg-card col-span-1">
                <p className="text-[10px] text-muted-foreground">إيراد مستهدف</p>
                <p className="text-sm font-bold text-primary">{data.TargetRevenue.toLocaleString('ar-EG')} ج.م</p>
              </div>
            )}
            {data.TargetNetProfit != null && data.TargetNetProfit > 0 && (
              <div className="rounded-lg border p-2 bg-card col-span-1">
                <p className="text-[10px] text-muted-foreground">ربح مستهدف</p>
                <p className="text-sm font-bold text-emerald-500">{data.TargetNetProfit.toLocaleString('ar-EG')} ج.م</p>
              </div>
            )}
          </div>
        )}

        {/* Header Edit */}
        <div className="p-3 border-b border-border">
          {!editingHeader ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{data.Notes || 'بدون ملاحظات'}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingHeader(true)}>
                <Pencil className="w-3 h-3 ml-1" /> تعديل
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-muted-foreground">هدف صافي الربح (ج.م)</label>
                <Input type="number" value={hProfit} onChange={e => setHProfit(e.target.value)} className="h-8 text-xs" dir="ltr" placeholder="مثال: 20000" />
                <p className="text-[9px] text-muted-foreground mt-0.5">سيتم حساب الإيراد المطلوب تلقائيًا</p>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">الحالة</label>
                <select value={hStatus} onChange={e => setHStatus(e.target.value as BudgetStatus)}
                  className="w-full h-8 rounded-md border border-border bg-background text-xs px-2">
                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">ملاحظات</label>
                <Input value={hNotes} onChange={e => setHNotes(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={saveHeader} disabled={savingHeader}>
                  {savingHeader ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 ml-1" />}
                  حفظ
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingHeader(false)}>إلغاء</Button>
              </div>
            </div>
          )}
        </div>

        {/* Add Line Form */}
        <div className="p-3 border-b border-border">
          {!showLineForm ? (
            <Button size="sm" className="w-full" onClick={openAddLine}>
              <Plus className="w-4 h-4 ml-1.5" /> إضافة بند جديد
            </Button>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold">{editingLineId ? 'تعديل بند' : 'بند جديد'}</h3>
                <button onClick={() => setShowLineForm(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground">اسم البند</label>
                <Input
                  value={lineForm.lineName}
                  onChange={e => setLineForm(f => ({ ...f, lineName: e.target.value }))}
                  className="h-8 text-xs" placeholder="مثال: إيجار، كهرباء..."
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">النوع</label>
                  <select
                    value={lineForm.lineType}
                    onChange={e => setLineForm(f => ({ ...f, lineType: e.target.value as BudgetLineType }))}
                    className="w-full h-8 rounded-md border border-border bg-background text-xs px-2"
                  >
                    {Object.entries(LINE_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">المبلغ المخطط</label>
                  <Input
                    type="number" min="0"
                    value={lineForm.plannedAmount || ''}
                    onChange={e => setLineForm(f => ({ ...f, plannedAmount: parseFloat(e.target.value) || 0 }))}
                    className="h-8 text-xs" dir="ltr"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">فئة المصروفات</label>
                  <select
                    value={lineForm.expINID || ''}
                    onChange={e => setLineForm(f => ({ ...f, expINID: parseInt(e.target.value) || null }))}
                    className="w-full h-8 rounded-md border border-border bg-background text-xs px-2"
                  >
                    <option value="">— بدون ربط —</option>
                    {categories.map(c => (
                      <option key={c.ExpINID} value={c.ExpINID}>{c.CatName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">الموظف</label>
                  <select
                    value={lineForm.empID || ''}
                    onChange={e => setLineForm(f => ({ ...f, empID: parseInt(e.target.value) || null }))}
                    className="w-full h-8 rounded-md border border-border bg-background text-xs px-2"
                  >
                    <option value="">— بدون ربط —</option>
                    {employees.map(e => (
                      <option key={e.EmpID} value={e.EmpID}>{e.EmpName}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">حد التحذير %</label>
                  <Input
                    type="number" min="0" max="100"
                    value={lineForm.warningThresholdPct ?? ''}
                    onChange={e => setLineForm(f => ({ ...f, warningThresholdPct: parseFloat(e.target.value) || null }))}
                    className="h-8 text-xs" dir="ltr"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">حد أقصى</label>
                  <Input
                    type="number" min="0"
                    value={lineForm.hardCapAmount ?? ''}
                    onChange={e => setLineForm(f => ({ ...f, hardCapAmount: parseFloat(e.target.value) || null }))}
                    className="h-8 text-xs" dir="ltr"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground">ملاحظات</label>
                <Input
                  value={lineForm.notes}
                  onChange={e => setLineForm(f => ({ ...f, notes: e.target.value }))}
                  className="h-8 text-xs" placeholder="اختياري"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={lineForm.isActive}
                  onChange={e => setLineForm(f => ({ ...f, isActive: e.target.checked }))}
                  className="rounded"
                  id="lineActive"
                />
                <label htmlFor="lineActive" className="text-xs">نشط</label>
              </div>

              {lineError && (
                <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded p-2">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  {lineError}
                </div>
              )}

              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={saveLine} disabled={savingLine}>
                  {savingLine ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 ml-1" />}
                  {editingLineId ? 'تحديث' : 'إضافة'}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowLineForm(false)}>
                  إلغاء
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Back button */}
        <div className="p-3 mt-auto border-t border-border">
          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => router.push('/budget')}>
            <ArrowRight className="w-3.5 h-3.5 ml-1" /> العودة لقائمة الميزانيات
          </Button>
        </div>
      </aside>

      {/* ═══════ RIGHT: Actual vs Budget Lines View ═══════ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/10">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold">المخطط مقابل الفعلي</h3>
            <span className="text-xs text-muted-foreground">({data.lines?.length || 0} بند)</span>
          </div>
          {summary && summary.totalPlanned > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">إجمالي نسبة الصرف:</span>
              <div className="w-20 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    summary.totalActual >= summary.totalPlanned ? 'bg-destructive' :
                    summary.totalActual >= summary.totalPlanned * 0.8 ? 'bg-yellow-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(Math.round((summary.totalActual / summary.totalPlanned) * 100), 100)}%` }}
                />
              </div>
              <span className={`text-xs font-bold ${
                summary.totalActual >= summary.totalPlanned ? 'text-destructive' :
                summary.totalActual >= summary.totalPlanned * 0.8 ? 'text-yellow-500' : 'text-emerald-500'
              }`}>
                {Math.round((summary.totalActual / summary.totalPlanned) * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* Lines */}
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-2">
            {(!data.lines || data.lines.length === 0) && (
              <div className="text-center py-16 text-muted-foreground">
                <Target className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">لا توجد بنود بعد</p>
                <p className="text-xs mt-1">أضف بنود الميزانية من اللوحة الجانبية</p>
              </div>
            )}

            {data.lines?.map((line) => {
              const actual = line.ActualAmount || 0;
              const planned = line.PlannedAmount || 0;
              const remaining = planned - actual;
              const burnPct = line.BurnPct || 0;
              const ws = line.WarningState || 'ok';

              const barColor = ws === 'over' ? 'bg-destructive' : ws === 'warning' ? 'bg-yellow-500' : 'bg-emerald-500';
              const textColor = ws === 'over' ? 'text-destructive' : ws === 'warning' ? 'text-yellow-500' : 'text-emerald-500';
              const typeColor = LINE_TYPE_COLORS[line.LineType as BudgetLineType] || LINE_TYPE_COLORS.other;

              return (
                <div
                  key={line.ID}
                  className={`rounded-lg border p-3 bg-card transition-colors ${
                    !line.IsActive ? 'opacity-50' : ws === 'over' ? 'border-destructive/30' : 'border-border'
                  }`}
                >
                  {/* Top row: name + type + actions */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-sm font-bold">{line.LineName}</span>
                      <Badge variant="outline" className={`text-[10px] h-5 ${typeColor}`}>
                        {LINE_TYPE_LABELS[line.LineType as BudgetLineType] || line.LineType}
                      </Badge>
                      {line.CatName && (
                        <span className="text-[10px] text-muted-foreground">📂 {line.CatName}</span>
                      )}
                      {line.EmpName && (
                        <span className="text-[10px] text-muted-foreground">👤 {line.EmpName}</span>
                      )}
                      {!line.IsActive && (
                        <Badge variant="outline" className="text-[10px] h-5">معطل</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEditLine(line)}
                        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteLine(line.ID)}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Numbers row */}
                  <div className="grid grid-cols-4 gap-3 mb-2">
                    <div>
                      <p className="text-[10px] text-muted-foreground">مخطط</p>
                      <p className="text-sm font-bold">{planned.toLocaleString('ar-EG')}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">فعلي</p>
                      <p className={`text-sm font-bold ${ws === 'over' ? 'text-destructive' : ''}`}>
                        {actual.toLocaleString('ar-EG')}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">متبقي</p>
                      <p className={`text-sm font-bold ${remaining < 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                        {remaining.toLocaleString('ar-EG')}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">الفرق</p>
                      <p className={`text-sm font-bold ${textColor}`}>
                        {burnPct}%
                        {ws === 'over' && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                        {ws === 'warning' && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                      </p>
                    </div>
                  </div>

                  {/* Burn bar */}
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${Math.min(burnPct, 100)}%` }}
                    />
                  </div>

                  {/* Notes */}
                  {line.Notes && (
                    <p className="text-[10px] text-muted-foreground mt-1.5">{line.Notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
