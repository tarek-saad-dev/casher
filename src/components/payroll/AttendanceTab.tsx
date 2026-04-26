'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Loader2, AlertCircle, CalendarCheck, Pencil, Check, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface AttendanceRecord {
  ID:           number;
  EmpID:        number;
  EmpName:      string;
  WorkDate:     string;
  CheckInTime:  string | null;
  CheckOutTime: string | null;
  Status:       string | null;
  Notes:        string | null;
  CreatedAt:    string;
  UpdatedAt:    string | null;
}

interface EmpOption { EmpID: number; EmpName: string; }

const STATUS_OPTIONS = [
  { value: 'present', label: 'حاضر' },
  { value: 'absent',  label: 'غائب' },
  { value: 'late',    label: 'متأخر' },
  { value: 'off',     label: 'إجازة' },
];

function statusBadge(s: string | null) {
  const map: Record<string, string> = {
    present: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    absent:  'bg-rose-500/10    text-rose-400    border-rose-500/20',
    late:    'bg-yellow-500/10  text-yellow-400  border-yellow-500/20',
    off:     'bg-zinc-700/50    text-zinc-400    border-zinc-700',
  };
  const labels: Record<string, string> = { present:'حاضر', absent:'غائب', late:'متأخر', off:'إجازة' };
  const cls = s ? (map[s] ?? 'bg-zinc-700/50 text-zinc-400 border-zinc-700') : 'bg-zinc-800/40 text-zinc-600 border-zinc-800';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {s ? (labels[s] ?? s) : '—'}
    </span>
  );
}

function today() { return new Date().toISOString().slice(0, 10); }
function weekAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

export default function AttendanceTab() {
  const [records,   setRecords]   = useState<AttendanceRecord[]>([]);
  const [employees, setEmployees] = useState<EmpOption[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  const [from,      setFrom]      = useState(weekAgo());
  const [to,        setTo]        = useState(today());
  const [empFilter, setEmpFilter] = useState('');

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    empId: '', workDate: today(), checkInTime: '', checkOutTime: '', status: 'present', notes: ''
  });
  const [formSaving, setFormSaving] = useState(false);
  const [formErr,    setFormErr]    = useState('');

  // Inline edit
  const [editId,    setEditId]    = useState<number | null>(null);
  const [editForm,  setEditForm]  = useState<Partial<AttendanceRecord>>({});
  const [editSaving,setEditSaving]= useState(false);

  const loadEmployees = useCallback(async () => {
    const res = await fetch('/api/employees');
    const d   = await res.json();
    setEmployees(Array.isArray(d) ? d.map((e: any) => ({ EmpID: e.EmpID, EmpName: e.EmpName })) : []);
  }, []);

  const loadRecords = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ from, to });
      if (empFilter) params.set('empId', empFilter);
      const res = await fetch(`/api/employees/attendance?${params}`);
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'خطأ في التحميل');
      setRecords(Array.isArray(d) ? d : []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [from, to, empFilter]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);
  useEffect(() => { loadRecords(); },  [loadRecords]);

  async function handleSubmit() {
    if (!form.empId || !form.workDate) { setFormErr('الموظف والتاريخ مطلوبان'); return; }
    setFormSaving(true); setFormErr('');
    try {
      const res = await fetch('/api/employees/attendance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId:        parseInt(form.empId),
          workDate:     form.workDate,
          checkInTime:  form.checkInTime  || null,
          checkOutTime: form.checkOutTime || null,
          status:       form.status       || null,
          notes:        form.notes        || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'خطأ في الحفظ');
      setModalOpen(false);
      await loadRecords();
    } catch (e: any) { setFormErr(e.message); }
    finally { setFormSaving(false); }
  }

  async function saveInlineEdit(id: number) {
    setEditSaving(true);
    try {
      const res = await fetch(`/api/employees/attendance/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkInTime:  editForm.CheckInTime  || null,
          checkOutTime: editForm.CheckOutTime || null,
          status:       editForm.Status       || null,
          notes:        editForm.Notes        || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setRecords(prev => prev.map(r => r.ID === id ? { ...r, ...d } : r));
      setEditId(null);
    } catch {}
    finally { setEditSaving(false); }
  }

  return (
    <div className="space-y-4">
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-end gap-3 p-4 bg-zinc-900/40 border border-zinc-800/60 rounded-xl">
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">من</label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="w-36 bg-zinc-800/50 border-zinc-700 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">إلى</label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="w-36 bg-zinc-800/50 border-zinc-700 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">الموظف</label>
          <select
            value={empFilter}
            onChange={e => setEmpFilter(e.target.value)}
            className="h-10 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 text-sm text-white"
          >
            <option value="">كل الموظفين</option>
            {employees.map(e => <option key={e.EmpID} value={e.EmpID}>{e.EmpName}</option>)}
          </select>
        </div>
        <Button
          onClick={() => { setModalOpen(true); setFormErr(''); setForm({ empId:'', workDate:today(), checkInTime:'', checkOutTime:'', status:'present', notes:'' }); }}
          className="bg-amber-600 hover:bg-amber-700 gap-2 mr-auto"
        >
          <Plus className="w-4 h-4" /> تسجيل حضور
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 text-rose-400 text-sm">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-300">سجلات الحضور</h3>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        </div>

        {!loading && records.length === 0 ? (
          <div className="p-12 text-center text-zinc-600">
            <CalendarCheck className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">لا توجد سجلات في هذه الفترة</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-right font-medium">الموظف</th>
                  <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                  <th className="px-4 py-3 text-right font-medium">الحضور</th>
                  <th className="px-4 py-3 text-right font-medium">الانصراف</th>
                  <th className="px-4 py-3 text-right font-medium">الحالة</th>
                  <th className="px-4 py-3 text-right font-medium">ملاحظات</th>
                  <th className="px-4 py-3 text-center font-medium">تعديل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {records.map(rec => (
                  <tr key={rec.ID} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-white">{rec.EmpName}</td>
                    <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{rec.WorkDate?.slice(0,10)}</td>

                    {editId === rec.ID ? (
                      <>
                        <td className="px-3 py-2">
                          <Input type="time" value={editForm.CheckInTime ?? ''} onChange={e => setEditForm(f=>({...f, CheckInTime:e.target.value}))}
                            className="w-28 bg-zinc-800/50 border-zinc-700 text-xs h-8" />
                        </td>
                        <td className="px-3 py-2">
                          <Input type="time" value={editForm.CheckOutTime ?? ''} onChange={e => setEditForm(f=>({...f, CheckOutTime:e.target.value}))}
                            className="w-28 bg-zinc-800/50 border-zinc-700 text-xs h-8" />
                        </td>
                        <td className="px-3 py-2">
                          <select value={editForm.Status ?? ''} onChange={e => setEditForm(f=>({...f, Status:e.target.value}))}
                            className="h-8 rounded-md border border-zinc-700 bg-zinc-800/50 px-2 text-xs text-white">
                            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <Input value={editForm.Notes ?? ''} onChange={e => setEditForm(f=>({...f, Notes:e.target.value}))}
                            className="w-32 bg-zinc-800/50 border-zinc-700 text-xs h-8" />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-400 hover:text-emerald-300"
                              onClick={() => saveInlineEdit(rec.ID)} disabled={editSaving}>
                              {editSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-400"
                              onClick={() => setEditId(null)}>
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 font-mono text-xs text-zinc-300">{rec.CheckInTime  ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-zinc-300">{rec.CheckOutTime ?? '—'}</td>
                        <td className="px-4 py-3">{statusBadge(rec.Status)}</td>
                        <td className="px-4 py-3 text-xs text-zinc-500 max-w-[120px] truncate">{rec.Notes ?? '—'}</td>
                        <td className="px-4 py-3 text-center">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-400 hover:text-white"
                            onClick={() => { setEditId(rec.ID); setEditForm({ CheckInTime: rec.CheckInTime ?? '', CheckOutTime: rec.CheckOutTime ?? '', Status: rec.Status ?? 'present', Notes: rec.Notes ?? '' }); }}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add Attendance Modal ── */}
      <Dialog open={modalOpen} onOpenChange={v => { if (!v) setModalOpen(false); }}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck className="w-5 h-5 text-amber-400" />
              تسجيل حضور
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">الموظف *</label>
                <select value={form.empId} onChange={e => setForm(f=>({...f, empId: e.target.value}))}
                  className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 text-sm text-white">
                  <option value="">اختر موظف</option>
                  {employees.map(e => <option key={e.EmpID} value={e.EmpID}>{e.EmpName}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">التاريخ *</label>
                <Input type="date" value={form.workDate} onChange={e => setForm(f=>({...f, workDate: e.target.value}))}
                  className="bg-zinc-800/50 border-zinc-700 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">وقت الحضور</label>
                <Input type="time" value={form.checkInTime} onChange={e => setForm(f=>({...f, checkInTime: e.target.value}))}
                  className="bg-zinc-800/50 border-zinc-700 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">وقت الانصراف</label>
                <Input type="time" value={form.checkOutTime} onChange={e => setForm(f=>({...f, checkOutTime: e.target.value}))}
                  className="bg-zinc-800/50 border-zinc-700 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">الحالة</label>
              <div className="flex gap-2 flex-wrap">
                {STATUS_OPTIONS.map(o => (
                  <button key={o.value} onClick={() => setForm(f=>({...f, status: o.value}))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      form.status === o.value
                        ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                        : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800/60'
                    }`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">ملاحظات</label>
              <Input placeholder="اختياري..." value={form.notes} onChange={e => setForm(f=>({...f, notes: e.target.value}))}
                className="bg-zinc-800/50 border-zinc-700 text-sm" />
            </div>
            {formErr && <p className="text-xs text-rose-400">{formErr}</p>}
            <div className="flex gap-2 justify-end" dir="ltr">
              <Button variant="outline" onClick={() => setModalOpen(false)} disabled={formSaving}>إلغاء</Button>
              <Button onClick={handleSubmit} disabled={formSaving} className="bg-amber-600 hover:bg-amber-700 gap-1">
                {formSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                حفظ
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
