'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Pencil, Check, X, Loader2, AlertCircle, Scissors
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';

interface Employee {
  EmpID:                  number;
  EmpName:                string;
  isActive:               boolean;
  BaseSalary:             number | null;
  SalaryType:             string | null;
  TargetCommissionPercent:number | null;
  TargetMinSales:         number | null;
  DefaultCheckInTime:     string | null;
  DefaultCheckOutTime:    string | null;
  IsPayrollEnabled:       boolean | null;
}

interface EditState {
  baseSalary:             string;
  salaryType:             string;
  targetCommissionPercent:string;
  targetMinSales:         string;
  defaultCheckInTime:     string;
  defaultCheckOutTime:    string;
  isPayrollEnabled:       boolean;
}

const SALARY_TYPES = [
  { value: 'monthly', label: 'شهري' },
  { value: 'daily',   label: 'يومي' },
  { value: 'hourly',  label: 'بالساعة' },
];

export default function PayrollSettingsTab() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [saveErr,   setSaveErr]   = useState('');

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
    setEditState({
      baseSalary:              String(emp.BaseSalary              ?? 0),
      salaryType:              emp.SalaryType                     ?? 'monthly',
      targetCommissionPercent: String(emp.TargetCommissionPercent ?? 0),
      targetMinSales:          String(emp.TargetMinSales          ?? 0),
      defaultCheckInTime:      emp.DefaultCheckInTime             ?? '',
      defaultCheckOutTime:     emp.DefaultCheckOutTime            ?? '',
      isPayrollEnabled:        emp.IsPayrollEnabled               ?? true,
    });
  }

  async function saveEdit(empID: number) {
    if (!editState) return;
    // Client-side validation
    const bs  = parseFloat(editState.baseSalary);
    const pct = parseFloat(editState.targetCommissionPercent);
    const ms  = parseFloat(editState.targetMinSales);
    if (isNaN(bs)  || bs  < 0) { setSaveErr('الراتب يجب أن يكون رقمًا موجبًا'); return; }
    if (isNaN(pct) || pct < 0 || pct > 100) { setSaveErr('نسبة التارجت بين 0 و 100'); return; }
    if (isNaN(ms)  || ms  < 0) { setSaveErr('أقل مبيعات يجب أن يكون رقمًا موجبًا'); return; }

    setSaving(true);
    setSaveErr('');
    try {
      const res = await fetch(`/api/employees/${empID}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseSalary:             bs,
          salaryType:             editState.salaryType,
          targetCommissionPercent:pct,
          targetMinSales:         ms,
          defaultCheckInTime:     editState.defaultCheckInTime  || null,
          defaultCheckOutTime:    editState.defaultCheckOutTime || null,
          isPayrollEnabled:       editState.isPayrollEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في الحفظ');
      setEmployees(prev => prev.map(e => e.EmpID === empID ? { ...e, ...data } : e));
      setEditingId(null);
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
          <h3 className="text-sm font-semibold text-zinc-300">إعدادات الرواتب والتارجت</h3>
        </div>

        <div className="divide-y divide-zinc-800/60">
          {employees.map(emp => (
            <div key={emp.EmpID}>
              {/* ── Main row ── */}
              <div className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-800/20 transition-colors">
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-amber-500/10 text-amber-400 shrink-0">
                  <Scissors className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white text-sm">{emp.EmpName}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    راتب: <span className="text-zinc-300">{emp.BaseSalary ?? 0} ج.م</span>
                    {' · '}تارجت: <span className="text-amber-400">{emp.TargetCommissionPercent ?? 0}%</span>
                    {' · '}أقل مبيعات: <span className="text-zinc-300">{emp.TargetMinSales ?? 0} ج.م</span>
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
                      <label className="text-xs text-zinc-500">الراتب الأساسي (ج.م)</label>
                      <Input
                        type="number" min="0" step="50"
                        value={editState.baseSalary}
                        onChange={e => setEditState(s => s && ({ ...s, baseSalary: e.target.value }))}
                        className="bg-zinc-800/50 border-zinc-700 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-500">نظام الراتب</label>
                      <select
                        value={editState.salaryType}
                        onChange={e => setEditState(s => s && ({ ...s, salaryType: e.target.value }))}
                        className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 text-sm text-white"
                      >
                        {SALARY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-500">نسبة التارجت (%)</label>
                      <Input
                        type="number" min="0" max="100" step="0.5"
                        value={editState.targetCommissionPercent}
                        onChange={e => setEditState(s => s && ({ ...s, targetCommissionPercent: e.target.value }))}
                        className="bg-zinc-800/50 border-zinc-700 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-500">أقل مبيعات للتارجت (ج.م)</label>
                      <Input
                        type="number" min="0" step="100"
                        value={editState.targetMinSales}
                        onChange={e => setEditState(s => s && ({ ...s, targetMinSales: e.target.value }))}
                        className="bg-zinc-800/50 border-zinc-700 text-sm"
                      />
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
                      حفظ التعديلات
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
