'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, CheckCircle2, AlertCircle,
  Loader2, UserPlus, Link2, Scissors, X, Zap
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface Employee {
  EmpID: number;
  EmpName: string;
  Job: string | null;
  isActive: boolean;
  BaseSalary: number | null;
  TargetCommissionPercent: number | null;
  TargetMinSales: number | null;
  DefaultCheckInTime: string | null;
  DefaultCheckOutTime: string | null;
  IsPayrollEnabled: boolean | null;
  AdvanceExpINID: number | null;
  AdvanceCatName: string | null;
  RevenueExpINID: number | null;
  RevenueCatName: string | null;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  // Modal state
  const [open,     setOpen]     = useState(false);
  const [empName,  setEmpName]  = useState('');
  const [saving,   setSaving]   = useState(false);
  const [saveErr,  setSaveErr]  = useState('');
  const [lastAdded, setLastAdded] = useState<Employee | null>(null);

  // Finance mapping modal state
  const [financeModalOpen, setFinanceModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [advanceCategories, setAdvanceCategories] = useState<any[]>([]);
  const [revenueCategories, setRevenueCategories] = useState<any[]>([]);
  const [selectedAdvance, setSelectedAdvance] = useState<string>('');
  const [selectedRevenue, setSelectedRevenue] = useState<string>('');
  const [financeSaving, setFinanceSaving] = useState(false);
  const [financeError, setFinanceError] = useState('');

  // Auto mapping state
  const [autoMapping, setAutoMapping] = useState(false);
  const [autoMappingResult, setAutoMappingResult] = useState<any>(null);
  const [showAutoMappingModal, setShowAutoMappingModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/employees');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في التحميل');
      setEmployees(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load finance categories
  const loadFinanceCategories = useCallback(async () => {
    try {
      const [advRes, revRes] = await Promise.all([
        fetch('/api/finance/categories?type=مصروفات'),
        fetch('/api/finance/categories?type=ايرادات')
      ]);
      
      const advData = await advRes.json();
      const revData = await revRes.json();
      
      if (advRes.ok) setAdvanceCategories(Array.isArray(advData) ? advData : []);
      if (revRes.ok) setRevenueCategories(Array.isArray(revData) ? revData : []);
    } catch (e: any) {
      console.error('Failed to load finance categories:', e.message);
    }
  }, []);

  // Open finance modal
  const openFinanceModal = async (employee: Employee) => {
    setSelectedEmployee(employee);
    setSelectedAdvance(employee.AdvanceExpINID?.toString() || '');
    setSelectedRevenue(employee.RevenueExpINID?.toString() || '');
    setFinanceError('');
    
    await loadFinanceCategories();
    setFinanceModalOpen(true);
  };

  // Close finance modal
  const closeFinanceModal = () => {
    setFinanceModalOpen(false);
    setSelectedEmployee(null);
    setSelectedAdvance('');
    setSelectedRevenue('');
    setFinanceError('');
  };

  // Save finance mapping
  const saveFinanceMapping = async () => {
    if (!selectedEmployee) return;
    
    setFinanceSaving(true);
    setFinanceError('');
    
    try {
      const payload: any = {};
      
      if (selectedAdvance) {
        payload.advanceExpINID = parseInt(selectedAdvance);
      }
      
      if (selectedRevenue) {
        payload.revenueExpINID = parseInt(selectedRevenue);
      }
      
      const res = await fetch(`/api/admin/employees/${selectedEmployee.EmpID}/finance-map`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في تحديث الربط المالي');
      
      await load();
      closeFinanceModal();
    } catch (e: any) {
      setFinanceError(e.message);
    } finally {
      setFinanceSaving(false);
    }
  };

  // Delete finance mapping
  const deleteFinanceMapping = async (type: 'advance' | 'revenue') => {
    if (!selectedEmployee) return;
    
    try {
      const res = await fetch(`/api/admin/employees/${selectedEmployee.EmpID}/finance-map`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في حذف الربط المالي');
      
      if (type === 'advance') setSelectedAdvance('');
      if (type === 'revenue') setSelectedRevenue('');
      
      await load();
    } catch (e: any) {
      setFinanceError(e.message);
    }
  };

  // Preview auto mapping
  const previewAutoMapping = async () => {
    try {
      const res = await fetch('/api/admin/employees/auto-revenue-map');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في جلب المعاينة');
      
      setAutoMappingResult(data);
      setShowAutoMappingModal(true);
    } catch (e: any) {
      console.error('Preview auto mapping error:', e.message);
    }
  };

  // Execute auto mapping
  const executeAutoMapping = async () => {
    setAutoMapping(true);
    try {
      const res = await fetch('/api/admin/employees/auto-revenue-map', {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في الربط التلقائي');
      
      setAutoMappingResult(data);
      await load();
    } catch (e: any) {
      console.error('Auto mapping error:', e.message);
    } finally {
      setAutoMapping(false);
    }
  };

  async function handleAdd() {
    if (!empName.trim()) { setSaveErr('اسم الموظف مطلوب'); return; }
    setSaving(true);
    setSaveErr('');
    try {
      const res  = await fetch('/api/employees', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ empName: empName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في الحفظ');
      setLastAdded(data);
      setEmpName('');
      setOpen(false);
      await load();
    } catch (e: any) {
      setSaveErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  const total    = employees.length;
  const active   = employees.filter(e => e.isActive).length;
  const advanceMapped = employees.filter(e => e.AdvanceExpINID !== null).length;
  const revenueMapped = employees.filter(e => e.RevenueExpINID !== null).length;
  const fullyMapped = employees.filter(e => e.AdvanceExpINID !== null && e.RevenueExpINID !== null).length;
  const unmapped = total - fullyMapped;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir="rtl">
      <PageHeader
        title="الموظفون"
        description="إدارة موظفي الصالون — كل موظف جديد يحصل تلقائياً على بند سلفة مرتبط به"
      >
        <div className="flex gap-2">
          {revenueMapped < total && (
            <Button
              className="gap-2 bg-blue-600 hover:bg-blue-700"
              onClick={previewAutoMapping}
              disabled={autoMapping}
            >
              {autoMapping ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> جاري الربط...</>
              ) : (
                <><Zap className="w-4 h-4" /> ربط تلقائي</>
              )}
            </Button>
          )}
          <Button
            className="gap-2 bg-amber-600 hover:bg-amber-700"
            onClick={() => { setOpen(true); setSaveErr(''); setEmpName(''); setLastAdded(null); }}
          >
            <Plus className="w-4 h-4" />
            موظف جديد
          </Button>
        </div>
      </PageHeader>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard title="إجمالي الموظفين"   value={total}    icon={<Users      className="w-5 h-5" />} variant="default" />
        <KpiCard title="نشطون"              value={active}   icon={<Scissors   className="w-5 h-5" />} variant="primary" />
        <KpiCard title="مربوطون بسلفة"      value={advanceMapped}   icon={<Link2      className="w-5 h-5" />} variant="success" />
        <KpiCard title="مربوطون بإيراد"     value={revenueMapped}   icon={<Link2      className="w-5 h-5" />} variant="primary" />
        <KpiCard title="كامل الربط"         value={fullyMapped} icon={<CheckCircle2 className="w-5 h-5" />} variant={fullyMapped === total ? 'success' : 'warning'} />
      </div>

      {/* ── Success toast after adding ── */}
      {lastAdded && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-400">تم إضافة الموظف بنجاح</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              <span className="font-medium text-white">{lastAdded.EmpName}</span>
              {' '}&mdash; تم إنشاء بند السلفة تلقائياً:
              {' '}<span className="font-mono text-amber-300">{lastAdded.AdvanceCatName}</span>
            </p>
          </div>
          <button onClick={() => setLastAdded(null)} className="text-zinc-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-300">قائمة الموظفين</h3>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        </div>

        {error && (
          <div className="p-6 text-center text-sm text-rose-400">{error}</div>
        )}

        {!loading && !error && employees.length === 0 && (
          <div className="p-12 text-center text-zinc-500">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">لا يوجد موظفون بعد</p>
          </div>
        )}

        {employees.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-right font-medium">#</th>
                <th className="px-4 py-3 text-right font-medium">الموظف</th>
                <th className="px-4 py-3 text-right font-medium">الوظيفة</th>
                <th className="px-4 py-3 text-right font-medium">الحالة</th>
                <th className="px-4 py-3 text-right font-medium">تصنيف السلفة</th>
                <th className="px-4 py-3 text-right font-medium">تصنيف الإيراد</th>
                <th className="px-4 py-3 text-right font-medium">الربط المالي</th>
                <th className="px-4 py-3 text-right font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {employees.map((emp) => (
                <tr key={emp.EmpID} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{emp.EmpID}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/10 text-amber-400 shrink-0">
                        <Scissors className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <span className="font-medium text-white">{emp.EmpName}</span>
                        {emp.Job && <p className="text-xs text-zinc-500">{emp.Job}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {emp.Job ? (
                      <span className="text-xs text-zinc-400">{emp.Job}</span>
                    ) : (
                      <span className="text-xs text-zinc-600 italic">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {emp.isActive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        نشط
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-700/50 text-zinc-400 border border-zinc-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                        غير نشط
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {emp.AdvanceCatName ? (
                      <span className="text-xs text-zinc-300 font-mono">{emp.AdvanceCatName}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-amber-400">
                        <AlertCircle className="w-3 h-3" />
                        غير مربوط
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {emp.RevenueCatName ? (
                      <span className="text-xs text-zinc-300 font-mono">{emp.RevenueCatName}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-amber-400">
                        <AlertCircle className="w-3 h-3" />
                        غير مربوط
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {emp.AdvanceExpINID && emp.RevenueExpINID ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        كامل
                      </span>
                    ) : emp.AdvanceExpINID || emp.RevenueExpINID ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-amber-400">
                        <AlertCircle className="w-3.5 h-3.5" />
                        جزئي
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-rose-400">
                        <X className="w-3.5 h-3.5" />
                        لا يوجد
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs gap-1 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                        onClick={() => openFinanceModal(emp)}
                      >
                        تعديل الربط
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Add Employee Modal ── */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) setOpen(false); }}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-amber-400" />
              إضافة موظف جديد
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {/* What happens explanation */}
            <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/40 p-3 space-y-1.5 text-xs text-zinc-400">
              <p className="font-semibold text-zinc-300 text-sm mb-2">ما سيحدث تلقائياً عند الإضافة:</p>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">١</span>
                <span>إنشاء الموظف في قاعدة البيانات</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">٢</span>
                <span>إنشاء بند مصروف سلفة باسم: <span className="font-mono text-amber-300">سلفه ( اسم الموظف )</span></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">٣</span>
                <span>ربط الموظف بالبند تلقائياً لتتبع السلف</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">اسم الموظف *</label>
              <Input
                placeholder="مثال: أحمد محمد"
                value={empName}
                onChange={(e) => setEmpName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                autoFocus
              />
              {empName.trim() && (
                <p className="text-xs text-zinc-500">
                  سيُنشأ بند السلفة باسم:{' '}
                  <span className="font-mono text-amber-400">سلفه ( {empName.trim()} )</span>
                </p>
              )}
            </div>

            {saveErr && <p className="text-sm text-rose-400">{saveErr}</p>}

            <div className="flex gap-2 justify-end" dir="ltr">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                إلغاء
              </Button>
              <Button
                onClick={handleAdd}
                disabled={saving || !empName.trim()}
                className="bg-amber-600 hover:bg-amber-700 gap-2"
              >
                {saving ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> جاري الحفظ...</>
                ) : (
                  <><UserPlus className="w-4 h-4" /> إضافة وربط</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Finance Mapping Modal ── */}
      <Dialog open={financeModalOpen} onOpenChange={(v) => { if (!v) closeFinanceModal(); }}>
        <DialogContent className="sm:max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5 text-amber-400" />
              تعديل الربط المالي - {selectedEmployee?.EmpName}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 pt-1">
            {financeError && (
              <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 text-sm text-rose-400">
                {financeError}
              </div>
            )}

            {/* Advance Mapping */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">تصنيف السلفة</label>
                {selectedAdvance && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs gap-1 border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                    onClick={() => deleteFinanceMapping('advance')}
                  >
                    <X className="w-3 h-3" />
                    حذف
                  </Button>
                )}
              </div>
              <Select value={selectedAdvance} onValueChange={setSelectedAdvance}>
                <SelectTrigger className="text-right">
                  <SelectValue placeholder="اختر تصنيف السلفة" />
                </SelectTrigger>
                <SelectContent>
                  {advanceCategories.map(cat => (
                    <SelectItem key={cat.ExpINID} value={cat.ExpINID.toString()}>
                      {cat.CatName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedEmployee?.AdvanceCatName && (
                <p className="text-xs text-zinc-500">
                  الحالي: <span className="font-mono text-amber-300">{selectedEmployee.AdvanceCatName}</span>
                </p>
              )}
            </div>

            {/* Revenue Mapping */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">تصنيف الإيراد</label>
                {selectedRevenue && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs gap-1 border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                    onClick={() => deleteFinanceMapping('revenue')}
                  >
                    <X className="w-3 h-3" />
                    حذف
                  </Button>
                )}
              </div>
              <Select value={selectedRevenue} onValueChange={setSelectedRevenue}>
                <SelectTrigger className="text-right">
                  <SelectValue placeholder="اختر تصنيف الإيراد" />
                </SelectTrigger>
                <SelectContent>
                  {revenueCategories.map(cat => (
                    <SelectItem key={cat.ExpINID} value={cat.ExpINID.toString()}>
                      {cat.CatName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedEmployee?.RevenueCatName && (
                <p className="text-xs text-zinc-500">
                  الحالي: <span className="font-mono text-amber-300">{selectedEmployee.RevenueCatName}</span>
                </p>
              )}
            </div>

            {/* Info Box */}
            <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/40 p-3 space-y-1.5 text-xs text-zinc-400">
              <p className="font-semibold text-zinc-300 text-sm mb-2">ملاحظات هامة:</p>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0">!</span>
                <span>السلفة تستخدم لتتبع سلف الموظفين من المصروفات</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-green-500/10 text-green-400 flex items-center justify-center text-[10px] font-bold shrink-0">!</span>
                <span>الإيراد يستخدم لتصنيف إيرادات الموظف في التقارير المالية</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">!</span>
                <span>يمكن حذف الربط بالضغط على زر "حذف" بجانب كل تصنيف</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end" dir="ltr">
              <Button variant="outline" onClick={closeFinanceModal} disabled={financeSaving}>
                إلغاء
              </Button>
              <Button
                onClick={saveFinanceMapping}
                disabled={financeSaving || (!selectedAdvance && !selectedRevenue)}
                className="bg-amber-600 hover:bg-amber-700 gap-2"
              >
                {financeSaving ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> جاري الحفظ...</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4" /> حفظ التعديلات</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Auto Mapping Modal ── */}
      <Dialog open={showAutoMappingModal} onOpenChange={(v) => { if (!v) setShowAutoMappingModal(false); }}>
        <DialogContent className="sm:max-w-3xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-blue-400" />
              الربط التلقائي للإيرادات
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 pt-1">
            {autoMappingResult && (
              <>
                {/* Statistics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-white">{autoMappingResult?.unmappedCount || 0}</p>
                    <p className="text-xs text-zinc-400">موظف بدون ربط</p>
                  </div>
                  {autoMappingResult?.statistics && (
                    <>
                      <div className="bg-blue-500/10 rounded-lg p-3 text-center border border-blue-500/30">
                        <p className="text-2xl font-bold text-blue-400">{autoMappingResult.statistics?.smartMappings}</p>
                        <p className="text-xs text-zinc-400">ربط ذكي</p>
                      </div>
                      <div className="bg-amber-500/10 rounded-lg p-3 text-center border border-amber-500/30">
                        <p className="text-2xl font-bold text-amber-400">{autoMappingResult.statistics?.individualMappings}</p>
                        <p className="text-xs text-zinc-400">ربط فردي</p>
                      </div>
                      <div className="bg-emerald-500/10 rounded-lg p-3 text-center border border-emerald-500/30">
                        <p className="text-2xl font-bold text-emerald-400">{autoMappingResult.statistics?.coverage}%</p>
                        <p className="text-xs text-zinc-400">نسبة التغطية</p>
                      </div>
                    </>
                  )}
                </div>

                {/* Preview Mappings */}
                {autoMappingResult?.previewMappings && (
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-300 mb-3">معاينة الربط المقترح:</h3>
                    <div className="max-h-60 overflow-y-auto rounded-lg border border-zinc-800">
                      <table className="w-full text-sm">
                        <thead className="bg-zinc-900/50 sticky top-0">
                          <tr className="text-zinc-500 text-xs uppercase tracking-wider">
                            <th className="px-3 py-2 text-right">الموظف</th>
                            <th className="px-3 py-2 text-right">الوظيفة</th>
                            <th className="px-3 py-2 text-right">تصنيف الإيراد</th>
                            <th className="px-3 py-2 text-right">نوع الربط</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/60">
                          {autoMappingResult.previewMappings.map((mapping: any, idx: number) => (
                            <tr key={idx} className="hover:bg-zinc-800/30">
                              <td className="px-3 py-2 font-medium text-white">{mapping.empName}</td>
                              <td className="px-3 py-2 text-zinc-400">{mapping.job || '—'}</td>
                              <td className="px-3 py-2 text-zinc-300">{mapping.category}</td>
                              <td className="px-3 py-2">
                                {mapping.type === 'smart' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                                    ذكي
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                    فردي
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Results after execution */}
                {autoMappingResult?.mappings && (
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-300 mb-3">نتائج الربط المنفذ:</h3>
                    <div className="max-h-60 overflow-y-auto rounded-lg border border-zinc-800">
                      <table className="w-full text-sm">
                        <thead className="bg-zinc-900/50 sticky top-0">
                          <tr className="text-zinc-500 text-xs uppercase tracking-wider">
                            <th className="px-3 py-2 text-right">الموظف</th>
                            <th className="px-3 py-2 text-right">تصنيف الإيراد</th>
                            <th className="px-3 py-2 text-right">نوع الربط</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/60">
                          {autoMappingResult.mappings.map((mapping: any, idx: number) => (
                            <tr key={idx} className="hover:bg-zinc-800/30">
                              <td className="px-3 py-2 font-medium text-white">{mapping.empName}</td>
                              <td className="px-3 py-2 text-zinc-300">{mapping.category}</td>
                              <td className="px-3 py-2">
                                {mapping.type === 'smart' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    ذكي
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                    فردي
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Info Box */}
            {!autoMappingResult?.mappings && (
              <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/40 p-3 space-y-1.5 text-xs text-zinc-400">
                <p className="font-semibold text-zinc-300 text-sm mb-2">كيف يعمل الربط التلقائي:</p>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0">1</span>
                  <span>يبحث عن تطابق اسم الموظف مع تصنيفات الإيرادات الموجودة</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0">2</span>
                  <span>إذا وجد تطابق، يستخدم التصنيف المطابق (ربط ذكي)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">3</span>
                  <span>إذا لم يجد تطابق، ينشئ "ايراد (اسم الموظف)" (ربط فردي)</span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 justify-end" dir="ltr">
              <Button variant="outline" onClick={() => setShowAutoMappingModal(false)}>
                إغلاق
              </Button>
              {!autoMappingResult?.mappings && autoMappingResult?.previewMappings && (
                <Button
                  onClick={executeAutoMapping}
                  disabled={autoMapping}
                  className="bg-blue-600 hover:bg-blue-700 gap-2"
                >
                  {autoMapping ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> جاري التنفيذ...</>
                  ) : (
                    <><Zap className="w-4 h-4" /> تنفيذ الربط التلقائي</>
                  )}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
