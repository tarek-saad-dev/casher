'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, CheckCircle2, AlertCircle,
  Loader2, UserPlus, Link2, Scissors, X
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface Employee {
  EmpID: number;
  EmpName: string;
  isActive: boolean;
  AdvanceExpINID: number | null;
  AdvanceCatName: string | null;
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
  const mapped   = employees.filter(e => e.AdvanceExpINID !== null).length;
  const unmapped = total - mapped;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir="rtl">
      <PageHeader
        title="الموظفون"
        description="إدارة موظفي الصالون — كل موظف جديد يحصل تلقائياً على بند سلفة مرتبط به"
      >
        <Button
          className="gap-2 bg-amber-600 hover:bg-amber-700"
          onClick={() => { setOpen(true); setSaveErr(''); setEmpName(''); setLastAdded(null); }}
        >
          <Plus className="w-4 h-4" />
          موظف جديد
        </Button>
      </PageHeader>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard title="إجمالي الموظفين"   value={total}    icon={<Users      className="w-5 h-5" />} variant="default" />
        <KpiCard title="نشطون"              value={active}   icon={<Scissors   className="w-5 h-5" />} variant="primary" />
        <KpiCard title="مربوطون بسلفة"      value={mapped}   icon={<Link2      className="w-5 h-5" />} variant="success" />
        <KpiCard title="بدون ربط"           value={unmapped} icon={<AlertCircle className="w-5 h-5" />} variant={unmapped > 0 ? 'warning' : 'default'} />
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
                <th className="px-4 py-3 text-right font-medium">الحالة</th>
                <th className="px-4 py-3 text-right font-medium">بند السلفة</th>
                <th className="px-4 py-3 text-right font-medium">ربط السلفة</th>
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
                      <span className="font-medium text-white">{emp.EmpName}</span>
                    </div>
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
                      <span className="text-xs text-zinc-600 italic">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {emp.AdvanceExpINID ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        مرتبط
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-amber-400">
                        <AlertCircle className="w-3.5 h-3.5" />
                        غير مرتبط
                      </span>
                    )}
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
    </div>
  );
}
