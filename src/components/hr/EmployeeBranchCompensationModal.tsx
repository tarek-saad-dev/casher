'use client';
import { useEffect, useState } from 'react';
import { Crown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Mode = 'global' | 'branch_monthly';
type Branch = { branchId: number; branchName: string; branchCode: string; isAssigned: boolean; enabled: boolean; monthlySalary: number | null };
type Details = { employee: { scope: Mode; payrollMethod: string; payrollEnabled: boolean }; effectiveFrom: string; branches: Branch[] };
type Props = { open: boolean; empId: number; empName: string; onClose: () => void; onSaved: (s: string) => void };

export default function EmployeeBranchCompensationModal(p: Props) {
  const [details, setDetails] = useState<Details | null>(null);
  const [mode, setMode] = useState<Mode>('global');
  const [date, setDate] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [globalSalary, setGlobalSalary] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!p.open) return;
    const abort = new AbortController();
    setDetails(null); setError('');
    fetch('/api/admin/employees/' + p.empId + '/compensation', { signal: abort.signal })
      .then(async (r) => { const data = await r.json(); if (!r.ok) throw Error(data.error); return data as Details; })
      .then((d) => {
        setDetails(d); setMode(d.employee.scope); setDate(d.effectiveFrom);
        setBranches(d.branches);
        setGlobalSalary(String(d.branches.find((b) => b.enabled && b.isAssigned)?.monthlySalary ?? ''));
      }).catch((e) => { if (!abort.signal.aborted) setError(String(e.message || e)); });
    return () => abort.abort();
  }, [p.empId, p.open]);
  const allowed = details?.employee.payrollEnabled && details.employee.payrollMethod === 'monthly';
  const amount = branches.reduce((sum, b) => sum + (b.enabled ? Number(b.monthlySalary) || 0 : 0), 0);
  const patch = (id: number, partial: Partial<Branch>) =>
    setBranches((rows) => rows.map((b) => b.branchId === id ? { ...b, ...partial } : b));
  const save = async () => {
    setError('');
    if (mode === 'branch_monthly' &&
      (!allowed || !branches.some((b) => b.enabled) ||
        branches.some((b) => b.enabled && (!b.isAssigned || !(Number(b.monthlySalary) > 0))))) {
      setError('فعّل راتبًا صحيحًا لفرع واحد على الأقل، وتأكد أن الموظف متعين عليه'); return;
    }
    if (mode === 'global' && !(Number(globalSalary) > 0)) {
      setError('حدد المرتب الشهري العام'); return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/admin/employees/' + p.empId + '/compensation', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, effectiveFrom: date, globalMonthlySalary: Number(globalSalary),
          branches: branches.map((b) => ({ branchId: b.branchId, enabled: b.enabled, monthlySalary: Number(b.monthlySalary) || 0 })) }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || 'تعذر الحفظ');
      p.onSaved('تم حفظ اتفاقيات ' + p.empName + ' اعتبارًا من ' + date);
      p.onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر الحفظ'); }
    finally { setSaving(false); }
  };
  return <Dialog open={p.open} onOpenChange={(v) => { if (!v && !saving) p.onClose(); }}>
    <DialogContent dir="rtl" className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Crown className="h-5 w-5 text-primary" /> مرتبات الفروع — {p.empName}</DialogTitle></DialogHeader>
      {!details && !error && <div className="py-12 text-center text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /> جارٍ التحميل</div>}
      {details && <div className="space-y-4">
        <div className="space-y-2 text-sm">
          <label className="flex gap-3 border border-border rounded-lg p-3 cursor-pointer">
            <input type="radio" name="salary-scope" checked={mode === 'global'} onChange={() => setMode('global')} /> المرتب العام (النظام الحالي)
          </label>
          <label className="flex gap-3 border border-border rounded-lg p-3 cursor-pointer">
            <input type="radio" name="salary-scope" checked={mode === 'branch_monthly'} onChange={() => setMode('branch_monthly')} /> مرتب شهري مستقل لكل فرع (VIP)
          </label>
        </div>
        {mode === 'branch_monthly' ? <div className="space-y-3">
          {!allowed && <p className="text-sm text-destructive">اختار طريقة المحاسبة الشهرية وفعّل رواتب الموظف من «تعديل الموظف» أولًا.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {branches.map((b) => <div key={b.branchId} className="rounded-lg border border-border p-3 space-y-3">
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>{b.branchName}</span>
                <input aria-label={'تفعيل ' + b.branchName} type="checkbox" checked={b.enabled}
                  disabled={!allowed || (!b.isAssigned && !b.enabled)} onChange={(e) => patch(b.branchId, { enabled: e.target.checked })} />
              </div>
              {!b.isAssigned && <p className="text-xs text-muted-foreground">عيّن الموظف على الفرع من «الفروع ومواعيد العمل».</p>}
              <label className="block text-xs text-muted-foreground">الراتب الشهري (ج.م)</label>
              <Input type="number" min={0} step="0.01" dir="ltr" value={b.monthlySalary ?? ''}
                disabled={!b.enabled || !b.isAssigned || !allowed}
                onChange={(e) => patch(b.branchId, { monthlySalary: e.target.value === '' ? null : Number(e.target.value) })} />
            </div>)}
          </div>
          <div className="rounded-lg bg-surface-muted/60 border border-border p-3 flex justify-between">
            <span>إجمالي المرتبات الشهرية</span><strong>{amount.toLocaleString('en-US')} ج.م</strong>
          </div>
        </div> : details.employee.scope === 'branch_monthly' ? <div className="space-y-2">
          <label className="text-sm">الراتب الشهري العام بعد إيقاف وضع VIP</label>
          <Input dir="ltr" type="number" min={0} value={globalSalary} onChange={(e) => setGlobalSalary(e.target.value)} />
        </div> : <p className="text-sm text-muted-foreground">الموظف على النظام العام بالفعل.</p>}
        <div className="space-y-2">
          <label className="text-sm">تاريخ بدء الاتفاقيات — أول شهر قادم</label>
          <Input type="date" min={details.effectiveFrom} dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
          <p className="text-xs text-muted-foreground">مش هنغير أي استحقاقات للشهور السابقة.</p>
        </div>
      </div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={saving} onClick={p.onClose}>إلغاء</Button>
        <Button disabled={!details || saving || (mode === 'global' && details.employee.scope === 'global') || (mode === 'branch_monthly' && !allowed)}
          onClick={() => void save()}>{saving ? 'جارٍ الحفظ...' : 'حفظ الاتفاقيات'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
