'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Pencil, Check, X, Loader2, AlertCircle, Scissors,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import { sqlTimeForInput, formatTime12h } from '@/lib/timeUtils';

interface Employee {
  EmpID:               number;
  EmpName:             string;
  isActive:            boolean;
  BaseSalary:          number | null;
  Salary:              number | null;
  SalaryType:          string | null;
  DefaultCheckInTime:  string | null;
  DefaultCheckOutTime: string | null;
  WorkScheduleNotes:   string | null;
  IsPayrollEnabled:    boolean | null;
  HourlyRate:          number | null;
}

interface EditState {
  dailyWage:           string;
  defaultCheckInTime:  string;
  defaultCheckOutTime: string;
  workScheduleNotes:   string;
  isPayrollEnabled:    boolean;
}


export default function PayrollSettingsTab() {
  const [employees,  setEmployees]  = useState<Employee[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [editState,  setEditState]  = useState<EditState | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [saveErr,    setSaveErr]    = useState('');
  const [successId,  setSuccessId]  = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/employees');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في التحميل');
      setEmployees(Array.isArray(data) ? data : []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openEdit(emp: Employee) {
    setEditingId(emp.EmpID);
    setSaveErr('');
    setSuccessId(null);
    const wage = emp.Salary ?? emp.BaseSalary ?? 0;
    setEditState({
      dailyWage:           String(wage),
      defaultCheckInTime:  sqlTimeForInput(emp.DefaultCheckInTime),
      defaultCheckOutTime: sqlTimeForInput(emp.DefaultCheckOutTime),
      workScheduleNotes:   emp.WorkScheduleNotes   ?? '',
      isPayrollEnabled:    emp.IsPayrollEnabled     ?? true,
    });
  }

  async function saveEdit(empID: number) {
    if (!editState) return;

    const wage = parseFloat(editState.dailyWage);
    if (isNaN(wage) || wage < 0) {
      setSaveErr('اليومية يجب أن تكون رقمًا موجبًا أو صفر');
      return;
    }
    if (editState.isPayrollEnabled && wage <= 0) {
      setSaveErr('يجب تحديد اليومية عند تفعيل نظام الرواتب');
      return;
    }

    setSaving(true);
    setSaveErr('');
    try {
      const res = await fetch(`/api/payroll/employees/${empID}/salary-settings`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dailyWage:           wage,
          isPayrollEnabled:    editState.isPayrollEnabled,
          defaultCheckInTime:  editState.defaultCheckInTime  || null,   // HH:mm from <input type="time">
          defaultCheckOutTime: editState.defaultCheckOutTime || null,
          workScheduleNotes:   editState.workScheduleNotes   || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في الحفظ');

      // Merge updated employee back into list
      setEmployees(prev => prev.map(e =>
        e.EmpID === empID
          ? {
              ...e,
              Salary:              data.employee.Salary,
              BaseSalary:          data.employee.BaseSalary,
              SalaryType:          data.employee.SalaryType,
              IsPayrollEnabled:    data.employee.IsPayrollEnabled,
              DefaultCheckInTime:  data.employee.DefaultCheckInTime,
              DefaultCheckOutTime: data.employee.DefaultCheckOutTime,
              WorkScheduleNotes:   data.employee.WorkScheduleNotes,
              HourlyRate:          data.employee.HourlyRate,
            }
          : e
      ));
      setEditingId(null);
      setSuccessId(empID);
      setTimeout(() => setSuccessId(null), 4000);
    } catch (e: any) { setSaveErr(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-zinc-500">
      <Loader2 className="w-6 h-6 animate-spin ml-2" />
      جاري التحميل...
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 p-4 rounded-lg border border-rose-500/30 bg-rose-500/5 text-rose-400">
      <AlertCircle className="w-4 h-4" /> {error}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40">
          <h3 className="text-sm font-semibold text-zinc-300">إعدادات اليوميات</h3>
          <p className="text-xs text-zinc-500 mt-0.5">جميع الموظفين على نظام يومي — اليومية تؤثر على توليد الرواتب اليومية</p>
        </div>

        {/* Success toast */}
        {successId !== null && (
          <div className="mx-4 mt-3 flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            تم تحديث يومية الموظف بنجاح
          </div>
        )}

        <div className="divide-y divide-zinc-800/60">
          {employees.map(emp => {
            const displayWage = emp.Salary ?? emp.BaseSalary ?? 0;
            return (
              <div key={emp.EmpID}>
                {/* ── Main row ── */}
                <div className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-800/20 transition-colors">
                  <div className="flex items-center justify-center w-9 h-9 rounded-full bg-amber-500/10 text-amber-400 shrink-0">
                    <Scissors className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white text-sm">{emp.EmpName}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      اليومية: <span className="text-zinc-300 font-medium">{displayWage} ج.م</span>
                      {emp.HourlyRate != null && (
                        <> · سعر الساعة: <span className="text-amber-400 font-medium">{Number(emp.HourlyRate).toFixed(2)} ج.م</span></>
                      )}
                      {emp.DefaultCheckInTime && (
                        <> · حضور: <span className="text-zinc-400">{formatTime12h(emp.DefaultCheckInTime)}</span></>
                      )}
                      {emp.DefaultCheckOutTime && (
                        <> · انصراف: <span className="text-zinc-400">{formatTime12h(emp.DefaultCheckOutTime)}</span></>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {emp.IsPayrollEnabled !== false ? (
                      <span className="text-xs px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full">مفعّل</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 bg-zinc-700/50 text-zinc-500 border border-zinc-700 rounded-full">موقوف</span>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-zinc-400 hover:text-white"
                      onClick={() => editingId === emp.EmpID ? setEditingId(null) : openEdit(emp)}
                    >
                      {editingId === emp.EmpID ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>

                {/* ── Edit panel ── */}
                {editingId === emp.EmpID && editState && (
                  <div className="px-4 pb-4 pt-2 bg-zinc-800/20 border-t border-zinc-800/60">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-3">
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-500">اليومية (ج.م)</label>
                        <Input
                          type="number" min="0" step="10"
                          value={editState.dailyWage}
                          onChange={e => setEditState(s => s && ({ ...s, dailyWage: e.target.value }))}
                          className="bg-zinc-800/50 border-zinc-700 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-500">نظام الراتب</label>
                        <div className="h-10 flex items-center px-3 rounded-md border border-zinc-700 bg-zinc-800/30 text-sm text-zinc-400">
                          يومي (ثابت)
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-500">سعر الساعة (محفوظ في DB)</label>
                        <div className="h-10 flex items-center px-3 rounded-md border border-amber-500/20 bg-amber-500/5 text-sm text-amber-400 font-medium">
                          {emp.HourlyRate != null
                            ? `${Number(emp.HourlyRate).toFixed(2)} ج.م / ساعة`
                            : <span className="text-zinc-500">يحتسب بعد الحفظ</span>}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-500">موعد الحضور</label>
                        <Input
                          type="time"
                          value={editState.defaultCheckInTime}
                          onChange={e => setEditState(s => s && ({ ...s, defaultCheckInTime: e.target.value }))}
                          className="bg-zinc-800/50 border-zinc-700 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-500">موعد الانصراف</label>
                        <Input
                          type="time"
                          value={editState.defaultCheckOutTime}
                          onChange={e => setEditState(s => s && ({ ...s, defaultCheckOutTime: e.target.value }))}
                          className="bg-zinc-800/50 border-zinc-700 text-sm"
                        />
                      </div>
                      <div className="space-y-1 col-span-2">
                        <label className="text-xs text-zinc-500">ملاحظات جدول العمل (اختياري)</label>
                        <Input
                          type="text"
                          value={editState.workScheduleNotes}
                          onChange={e => setEditState(s => s && ({ ...s, workScheduleNotes: e.target.value }))}
                          className="bg-zinc-800/50 border-zinc-700 text-sm"
                          placeholder="مثال: يعمل من السبت للخميس"
                        />
                      </div>
                      <div className="space-y-1 flex flex-col justify-end">
                        <label className="text-xs text-zinc-500">تفعيل نظام الرواتب</label>
                        <button
                          onClick={() => setEditState(s => s && ({ ...s, isPayrollEnabled: !s.isPayrollEnabled }))}
                          className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors ${
                            editState.isPayrollEnabled
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                              : 'bg-zinc-800/50 border-zinc-700 text-zinc-400'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${editState.isPayrollEnabled ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                          {editState.isPayrollEnabled ? 'مفعّل' : 'موقوف'}
                        </button>
                      </div>
                    </div>

                    {saveErr && <p className="text-xs text-rose-400 mb-2">{saveErr}</p>}

                    <div className="flex gap-2" dir="ltr">
                      <Button variant="outline" size="sm" onClick={() => setEditingId(null)} disabled={saving}>إلغاء</Button>
                      <Button
                        size="sm"
                        onClick={() => saveEdit(emp.EmpID)}
                        disabled={saving}
                        className="bg-amber-600 hover:bg-amber-700 gap-1"
                      >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        حفظ اليومية
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
