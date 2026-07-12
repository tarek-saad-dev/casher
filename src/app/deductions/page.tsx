'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Save, Loader2, AlertTriangle, CheckCircle2,
  Banknote, CreditCard, Wallet, Receipt,
  TrendingDown, Filter, RotateCcw, Search, Zap, Edit2, Trash2, ChevronDown, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import ShiftRequiredOverlay from '@/components/session/ShiftRequiredOverlay';
import DeductionReceiptPopup from '@/components/deductions/DeductionReceiptPopup';
import MonthlySummary from '@/components/deductions/MonthlySummary';
import { useSession } from '@/hooks/useSession';
import { cashMoveDeleteToastMessage, notifyEmployeeLedgerRefresh } from '@/lib/cashMoveDeleteClient';

// ═══════════════════════════════════════════════════════════
// DEDUCTIONS PAGE — Employee Deductions Form + History + Summary
// ═══════════════════════════════════════════════════════════

// ──── Types ────
interface Employee {
  EmpID: number;
  EmpName: string;
  Job: string;
  AdvanceExpINID: number;
  AdvanceCatName: string;
}

interface PaymentMethod {
  ID: number;
  Name: string;
}

interface DeductionRecord {
  ID: number;
  invID: number;
  invDate: string;
  invTime: string;
  ExpINID: number;
  CatName: string;
  GrandTolal: number;
  Notes: string | null;
  ShiftMoveID: number;
  PaymentMethodID: number;
  PaymentMethod: string;
  UserName: string | null;
  EmpID: number;
  EmpName: string;
}

export default function DeductionsPage() {
  const { shift, hasActiveShift } = useSession();

  // ──── Lookup data ────
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  // ──── Form state ────
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  // ──── Toast ────
  const [toasts, setToasts] = useState<{ id: number; type: 'success' | 'error' | 'info'; message: string }[]>([]);
  const toastIdRef = useRef(0);
  const addToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = ++toastIdRef.current;
    setToasts(p => [...p, { id, type, message }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  }, []);

  // ──── Date helpers (local time, not UTC) ────
  function getLocalDateString(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ──── History / filter state ────
  const [deductions, setDeductions] = useState<DeductionRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activeDatePreset, setActiveDatePreset] = useState<'today' | 'yesterday' | 'last7' | 'thisMonth' | 'all' | 'custom'>('today');
  const [dateFrom, setDateFrom] = useState<string>(() => getLocalDateString(new Date()));
  const [dateTo, setDateTo] = useState<string>(() => getLocalDateString(new Date()));
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>('');
  const [filterPaymentMethodId, setFilterPaymentMethodId] = useState<string>('');
  const [dateError, setDateError] = useState<string>('');
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [sortByAmountDesc, setSortByAmountDesc] = useState(false);
  const [showMonthlySummary, setShowMonthlySummary] = useState(false);

  // ──── Receipt state ────
  const [receiptDeduction, setReceiptDeduction] = useState<{
    deductionInvID: number;
    incomeInvID: number;
    invDate: string;
    invTime: string;
    employeeName: string;
    categoryName: string;
    amount: number;
    PaymentMethod: string | null;
    Notes: string | null;
    UserName: string | null;
  } | null>(null);

  // ──── Set page title ────
  useEffect(() => {
    document.title = 'الخصومات | نظام نقاط البيع';
  }, []);

  // ──── Load lookup data on mount ────
  useEffect(() => {
    fetch('/api/employees')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setEmployees(d); })
      .catch(() => { });
    fetch('/api/payment-methods')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setPaymentMethods(d); })
      .catch(() => { });
  }, []);

  // ──── Quick date presets ────
  const applyPreset = useCallback((preset: typeof activeDatePreset) => {
    const today = new Date();
    setDateError('');
    setActiveDatePreset(preset);
    setShowCustomRange(preset === 'custom');
    switch (preset) {
      case 'today': {
        const t = getLocalDateString(today);
        setDateFrom(t); setDateTo(t); break;
      }
      case 'yesterday': {
        const y = new Date(today); y.setDate(today.getDate() - 1);
        const ys = getLocalDateString(y);
        setDateFrom(ys); setDateTo(ys); break;
      }
      case 'last7': {
        const f = new Date(today); f.setDate(today.getDate() - 6);
        setDateFrom(getLocalDateString(f)); setDateTo(getLocalDateString(today)); break;
      }
      case 'thisMonth': {
        const f = new Date(today.getFullYear(), today.getMonth(), 1);
        setDateFrom(getLocalDateString(f)); setDateTo(getLocalDateString(today)); break;
      }
      case 'all':
        setDateFrom(''); setDateTo(''); break;
      case 'custom':
        break;
    }
  }, [activeDatePreset]);

  // ──── Load deductions history ────
  const loadDeductions = useCallback(() => {
    if (dateError) return;
    setLoadingHistory(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (filterEmployeeId) params.set('employeeId', filterEmployeeId);
    if (filterPaymentMethodId && filterPaymentMethodId !== 'all') {
      params.set('paymentMethodId', filterPaymentMethodId);
    }
    fetch(`/api/deductions?${params.toString()}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setDeductions(d); })
      .catch(() => { })
      .finally(() => setLoadingHistory(false));
  }, [dateFrom, dateTo, filterEmployeeId, filterPaymentMethodId, dateError]);

  useEffect(() => { loadDeductions(); }, [loadDeductions]);

  // ──── Summary calculations ────
  const sortedDeductions = useMemo(() => {
    if (sortByAmountDesc) {
      return [...deductions].sort((a, b) => (b.GrandTolal || 0) - (a.GrandTolal || 0));
    }
    return deductions;
  }, [deductions, sortByAmountDesc]);

  const totalDeductions = sortedDeductions.reduce((sum, d) => sum + (d.GrandTolal || 0), 0);
  const totalCash = sortedDeductions.filter(d => d.PaymentMethod === 'كاش').reduce((sum, d) => sum + (d.GrandTolal || 0), 0);
  const totalVisa = sortedDeductions.filter(d => d.PaymentMethod === 'فيزا').reduce((sum, d) => sum + (d.GrandTolal || 0), 0);

  // ──── Handle custom date input ────
  const handleCustomFrom = (val: string) => {
    setDateFrom(val); setActiveDatePreset('custom'); setDateError('');
    if (dateTo && val > dateTo) setDateError('تاريخ البداية لا يمكن أن يكون بعد تاريخ النهاية');
  };
  const handleCustomTo = (val: string) => {
    setDateTo(val); setActiveDatePreset('custom'); setDateError('');
    if (dateFrom && val < dateFrom) setDateError('تاريخ البداية لا يمكن أن يكون بعد تاريخ النهاية');
  };

  // ──── Reset filters ────
  const handleResetFilters = useCallback(() => {
    applyPreset('today');
    setFilterEmployeeId('');
    setFilterPaymentMethodId('');
    setDateError('');
    setShowCustomRange(false);
  }, [applyPreset]);

  // ──── Friendly period label ────
  const periodLabel = useMemo(() => {
    switch (activeDatePreset) {
      case 'today': return 'عرض خصومات اليوم';
      case 'yesterday': return 'عرض خصومات أمس';
      case 'last7': return 'آخر 7 أيام';
      case 'thisMonth': return 'هذا الشهر';
      case 'all': return 'عرض كل الخصومات';
      case 'custom':
        if (dateFrom && dateTo && dateFrom === dateTo) return `خصومات ${dateFrom}`;
        if (dateFrom && dateTo) return `من ${dateFrom} إلى ${dateTo}`;
        if (dateFrom) return `من ${dateFrom}`;
        if (dateTo) return `حتى ${dateTo}`;
        return 'فترة مخصصة';
    }
  }, [activeDatePreset, dateFrom, dateTo]);

  // ──── Reset form ────
  const resetForm = useCallback(() => {
    setSelectedEmployeeId(null);
    setAmount('');
    setNotes('');
    setSaveError('');
    setSaveSuccess('');
  }, []);

  // ──── Save deduction ────
  const handleSave = useCallback(async () => {
    setSaveError('');
    setSaveSuccess('');

    if (!selectedEmployeeId) { setSaveError('يجب اختيار الموظف'); return; }
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) { setSaveError('يجب إدخال مبلغ صحيح أكبر من صفر'); return; }
    if (!paymentMethodId) { setSaveError('يجب اختيار طريقة الدفع'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/deductions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selectedEmployeeId,
          amount: amountNum,
          paymentMethodId,
          notes,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSaveError(data.error || 'خطأ في حفظ الخصم');
        return;
      }

      const result = await res.json();
      let successMsg = `✅ تم تسجيل الخصم بنجاح — #${result.deductionInvID} (${result.employeeName}: ${result.amount} ج.م)`;
      if (result.ledgerDualWrite) {
        successMsg += ' — تم تسجيل السلفة في دفتر الموظف';
      }
      setSaveSuccess(successMsg);

      // Get current date and time for receipt
      const now = new Date();
      const currentDate = now.toISOString().split('T')[0];
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // Get payment method name
      const paymentMethod = paymentMethods.find(pm => pm.ID === paymentMethodId);

      // Show receipt modal
      setReceiptDeduction({
        deductionInvID: result.deductionInvID,
        incomeInvID: result.incomeInvID,
        invDate: currentDate,
        invTime: currentTime,
        employeeName: result.employeeName,
        categoryName: result.categoryName,
        amount: result.amount,
        PaymentMethod: paymentMethod?.Name || null,
        Notes: notes || null,
        UserName: null,
      });

      resetForm();
      setPaymentMethodId(null);
      loadDeductions();

      // Clear success after 5s
      setTimeout(() => setSaveSuccess(''), 5000);
    } catch {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  }, [selectedEmployeeId, amount, paymentMethodId, notes, paymentMethods, resetForm, loadDeductions]);

  // ──── Delete deduction ────
  const handleDelete = useCallback(async (id: number, invID: number) => {
    if (!confirm(`هل أنت متأكد من حذف الخصم #${invID}؟`)) return;
    const reason = window.prompt('سبب حذف الخصم (مطلوب):');
    if (reason === null) return;
    if (!reason.trim()) {
      addToast('error', 'يجب إدخال سبب للحذف');
      return;
    }
    try {
      const res = await fetch(`/api/expenses/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        addToast('error', data.error || 'فشل حذف الخصم');
      } else {
        addToast('success', cashMoveDeleteToastMessage(data, 'تم حذف الخصم بنجاح'));
        if (data.ledgerDeletedCount > 0) notifyEmployeeLedgerRefresh();
        loadDeductions();
      }
    } catch {
      addToast('error', 'خطأ في الاتصال بالخادم');
    }
  }, [loadDeductions, addToast]);

  // ──── Payment method icons ────
  const PAYMENT_ICONS: Record<string, React.ReactNode> = {
    'كاش': <Banknote className="w-4 h-4" />,
    'فيزا': <CreditCard className="w-4 h-4" />,
  };

  // ──── Format date ────
  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('ar-EG'); } catch { return d; }
  };

  return (
    <div className="flex flex-col lg:flex-row h-screen overflow-hidden relative" dir="rtl">
      <ShiftRequiredOverlay />

      {/* ═══════════ LEFT PANEL: History + Summary ═══════════ */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background order-1 lg:order-1 min-h-0">
        {/* Summary Cards */}
        <div className="p-2 sm:p-3 border-b border-border bg-gradient-to-br from-muted/30 to-muted/10 shrink-0">
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            <div className="rounded-lg border border-border p-2 sm:p-2.5 bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-1 sm:gap-1.5 text-muted-foreground mb-1">
                <TrendingDown className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="text-[9px] sm:text-[10px] font-medium">إجمالي</span>
              </div>
              <p className="text-sm sm:text-lg font-black truncate">{totalDeductions.toLocaleString('ar-EG')} ج.م</p>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground">{deductions.length} عملية</p>
            </div>
            <div className="rounded-lg border border-border p-2 sm:p-2.5 bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-1 sm:gap-1.5 text-muted-foreground mb-1">
                <Banknote className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="text-[9px] sm:text-[10px] font-medium">كاش</span>
              </div>
              <p className="text-sm sm:text-lg font-bold truncate">{totalCash.toLocaleString('ar-EG')} ج.م</p>
            </div>
            <div className="rounded-lg border border-border p-2 sm:p-2.5 bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-1 sm:gap-1.5 text-muted-foreground mb-1">
                <CreditCard className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="text-[9px] sm:text-[10px] font-medium">فيزا</span>
              </div>
              <p className="text-sm sm:text-lg font-bold truncate">{totalVisa.toLocaleString('ar-EG')} ج.م</p>
            </div>
          </div>
        </div>

        {/* Monthly Summary */}
        <MonthlySummary 
          isVisible={showMonthlySummary} 
          onToggle={() => setShowMonthlySummary(!showMonthlySummary)} 
        />

        {/* ═══ Filters Bar ═══ */}
        <div className="px-2 sm:px-3 pt-2 sm:pt-2.5 pb-2 border-b border-border bg-zinc-900/60 space-y-2 shrink-0">
          {/* Row 1: Preset buttons + employee */}
          <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
            <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-zinc-500 shrink-0" />

            {([
              { key: 'today', label: 'اليوم', fullLabel: 'اليوم' },
              { key: 'yesterday', label: 'أمس', fullLabel: 'أمس' },
              { key: 'last7', label: 'آخر 7', fullLabel: 'آخر 7 أيام' },
              { key: 'thisMonth', label: 'الشهر', fullLabel: 'هذا الشهر' },
              { key: 'all', label: 'الكل', fullLabel: 'الكل' },
            ] as const).map(({ key, label, fullLabel }) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`text-[10px] sm:text-[11px] px-2 sm:px-2.5 py-1 rounded-md border font-semibold transition-all ${activeDatePreset === key
                  ? 'border-primary bg-primary/15 text-primary shadow-sm shadow-primary/20'
                  : 'border-border text-muted-foreground hover:border-zinc-500 hover:text-foreground hover:bg-accent'
                  }`}
                title={fullLabel}
              >
                {label}
              </button>
            ))}

            {/* Custom range toggle */}
            <button
              onClick={() => { setShowCustomRange(v => !v); if (activeDatePreset !== 'custom') setActiveDatePreset('custom'); }}
              className={`text-[10px] sm:text-[11px] px-2 sm:px-2.5 py-1 rounded-md border font-semibold transition-all flex items-center gap-1 ${activeDatePreset === 'custom'
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-400'
                : 'border-border text-muted-foreground hover:border-zinc-500 hover:text-foreground hover:bg-accent'
                }`}
            >
              <span className="hidden sm:inline">فترة مخصصة</span>
              <span className="sm:hidden">مخصص</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showCustomRange ? 'rotate-180' : ''}`} />
            </button>

            <div className="flex-1" />

            {/* Employee filter */}
            <select
              value={filterEmployeeId}
              onChange={(e) => setFilterEmployeeId(e.target.value)}
              className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-1 rounded-md border border-border bg-zinc-800/60 text-foreground max-w-[120px] sm:max-w-[160px] truncate"
            >
              <option value="">كل الموظفين</option>
              {employees.map(emp => (
                <option key={emp.EmpID} value={emp.EmpID}>{emp.EmpName}</option>
              ))}
            </select>

            {/* Payment Method filter */}
            <select
              value={filterPaymentMethodId}
              onChange={(e) => setFilterPaymentMethodId(e.target.value)}
              className="text-[11px] px-2 py-1 rounded-md border border-border bg-zinc-800/60 text-foreground max-w-[140px] truncate"
            >
              <option value="">كل وسائل الدفع</option>
              {paymentMethods.map(pm => (
                <option key={pm.ID} value={pm.ID}>{pm.Name}</option>
              ))}
            </select>

            {/* Reset */}
            <button
              onClick={handleResetFilters}
              className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-all flex items-center gap-1"
              title="إعادة تعيين"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">إعادة تعيين</span>
            </button>
          </div>

          {/* Row 2: Custom date range (collapsible) */}
          {showCustomRange && (
            <div className="flex items-center gap-2 flex-wrap pt-0.5">
              <span className="text-[10px] sm:text-[11px] text-zinc-500">من</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => handleCustomFrom(e.target.value)}
                className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-1 rounded-md border border-border bg-zinc-800/60 text-foreground"
              />
              <span className="text-[10px] sm:text-[11px] text-zinc-500">إلى</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => handleCustomTo(e.target.value)}
                className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-1 rounded-md border border-border bg-zinc-800/60 text-foreground"
              />
              {dateError && (
                <span className="text-[9px] sm:text-[10px] text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />{dateError}
                </span>
              )}
            </div>
          )}

          {/* Period label */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-zinc-500">
              <span className="text-zinc-400 font-medium">{periodLabel}</span>
              {deductions.length > 0 && !loadingHistory && (
                <span className="mr-1.5 text-zinc-600">— {deductions.length} عملية</span>
              )}
            </p>
            <button
              onClick={loadDeductions}
              disabled={!!dateError}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3" />
              تحديث
            </button>
          </div>
        </div>

        {/* Deductions List */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-3">
            {loadingHistory && (
              <div className="text-center py-8 text-muted-foreground">
                <Loader2 className="w-5 h-5 mx-auto animate-spin mb-2" />
                جاري التحميل...
              </div>
            )}

            {!loadingHistory && deductions.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">
                  {filterEmployeeId || (filterPaymentMethodId && filterPaymentMethodId !== 'all')
                    ? `لا توجد خصومات بالفلاتر المحددة`
                    : 'لا توجد خصومات'}
                </p>
                <p className="text-xs mt-1">
                  {filterEmployeeId || (filterPaymentMethodId && filterPaymentMethodId !== 'all')
                    ? 'جرب تغيير الفلاتر'
                    : 'سجّل خصم جديد من النموذج على اليسار'}
                </p>
              </div>
            )}

            {/* List Header */}
            {!loadingHistory && sortedDeductions.length > 0 && (
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-foreground">
                    {activeDatePreset === 'today' ? 'خصومات اليوم' :
                      activeDatePreset === 'yesterday' ? 'خصومات أمس' :
                        activeDatePreset === 'last7' ? 'آخر 7 أيام' :
                          activeDatePreset === 'thisMonth' ? 'خصومات الشهر' : 'عرض الخصومات'}
                  </span>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    {sortedDeductions.length} عملية
                  </span>
                </div>
                <button
                  onClick={() => setSortByAmountDesc(!sortByAmountDesc)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-all ${sortByAmountDesc
                      ? 'bg-amber-500/10 border-amber-500/50 text-amber-400'
                      : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:text-zinc-300'
                    }`}
                >
                  <TrendingDown className="w-3.5 h-3.5" />
                  {sortByAmountDesc ? 'الأعلى للأقل' : 'ترتيب'}
                </button>
              </div>
            )}

            {!loadingHistory && sortedDeductions.length > 0 && (
              <div className="space-y-2">
                {sortedDeductions.map((deduction, index) => {
                  const rank = sortByAmountDesc ? index + 1 : null;

                  return (
                    <div
                      key={deduction.ID}
                      className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors"
                      style={{ scrollMarginTop: '10px' }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className={`flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${rank === 1 ? 'bg-amber-500 text-amber-950' :
                            rank === 2 ? 'bg-zinc-300 text-zinc-900' :
                              rank === 3 ? 'bg-orange-500 text-orange-950' :
                                'bg-destructive/10 text-destructive'
                          }`}>
                          {rank && rank <= 3 ? (
                            <span className="text-lg font-black">{rank}</span>
                          ) : (
                            <Users className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-sm font-bold truncate">{deduction.EmpName}</span>
                            <Badge variant="outline" className="text-[9px] h-4 px-1">
                              #{deduction.invID}
                            </Badge>
                            {sortByAmountDesc && rank && rank <= 3 && (
                              <Badge
                                variant="outline"
                                className={`text-[10px] h-5 px-2 font-bold ${rank === 1 ? 'bg-amber-500/20 border-amber-500 text-amber-400' :
                                    rank === 2 ? 'bg-zinc-400/20 border-zinc-400 text-zinc-300' :
                                      'bg-orange-500/20 border-orange-500 text-orange-400'
                                  }`}
                              >
                                {rank === 1 ? '🥇 الأعلى' : rank === 2 ? '🥈' : '🥉'}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span>{fmtDate(deduction.invDate)}</span>
                            <span>·</span>
                            <span>{deduction.CatName}</span>
                            {deduction.UserName && (
                              <>
                                <span>·</span>
                                <span>{deduction.UserName}</span>
                              </>
                            )}
                            {deduction.PaymentMethod && (
                              <>
                                <span>·</span>
                                <span>{deduction.PaymentMethod}</span>
                              </>
                            )}
                          </div>
                          {deduction.Notes && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[250px]">
                              {deduction.Notes}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 mr-2">
                        <button
                          onClick={() => handleDelete(deduction.ID, deduction.invID)}
                          className="p-1.5 hover:bg-red-100 rounded-lg transition-colors"
                          title="حذف"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-500 hover:text-red-600" />
                        </button>
                        <span className="text-sm font-black text-destructive">
                          {deduction.GrandTolal?.toLocaleString('ar-EG')} ج.م
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════ RIGHT PANEL: New Deduction Form ═══════════ */}
      <aside className="w-full lg:w-[380px] border-r border-border flex flex-col shrink-0 bg-muted/5 order-2 lg:order-2 h-[45vh] lg:h-auto">
        <div className="p-3 border-b border-border bg-muted/20">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Receipt className="w-4 h-4" />
            تسجيل خصم جديد (سلفة موظف)
          </h2>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-3">
            {/* Employee Selection */}
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground mb-1.5 block">
                الموظف *
              </label>
              <select
                value={selectedEmployeeId || ''}
                onChange={(e) => setSelectedEmployeeId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">— اختر الموظف —</option>
                {employees.map((emp) => (
                  <option key={emp.EmpID} value={emp.EmpID}>
                    {emp.EmpName} {emp.Job && `(${emp.Job})`}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground mb-1.5 block">
                المبلغ (ج.م) *
              </label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                dir="ltr"
              />
            </div>

            {/* Payment Method */}
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground mb-1.5 block">
                طريقة الدفع *
              </label>
              <select
                value={paymentMethodId || ''}
                onChange={(e) => setPaymentMethodId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">— اختر طريقة الدفع —</option>
                {paymentMethods.map((pm) => (
                  <option key={pm.ID} value={pm.ID}>
                    {pm.Name}
                  </option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground mb-1.5 block">
                ملاحظات
              </label>
              <Input
                placeholder="ملاحظات الخصم..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* Save Error */}
            {saveError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {saveError}
              </div>
            )}

            {/* Save Success */}
            {saveSuccess && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {saveSuccess}
              </div>
            )}

            {/* Save Button */}
            <Button
              onClick={handleSave}
              disabled={saving || !selectedEmployeeId || !amount || !paymentMethodId}
              className="w-full gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  حفظ الخصم
                </>
              )}
            </Button>
          </div>
        </ScrollArea>
      </aside>

      {/* Toasts */}
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`fixed bottom-4 left-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl text-sm font-medium transition-all ${
            toast.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300' :
            toast.type === 'error' ? 'bg-rose-950/90 border-rose-500/40 text-rose-300' :
            'bg-zinc-900/90 border-zinc-700/40 text-zinc-300'
          }`}
        >
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
          {toast.type === 'error' && <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      ))}

      {/* Deduction Receipt Popup */}
      <DeductionReceiptPopup
        open={!!receiptDeduction}
        deduction={receiptDeduction}
        onClose={() => setReceiptDeduction(null)}
      />
    </div>
  );
}
