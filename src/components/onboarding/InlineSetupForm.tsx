'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, Plus } from 'lucide-react';
import SmartTeamSetup, { type TeamEmployee } from './SmartTeamSetup';
import { SETUP_JOBS } from '@/platform/onboarding/selfServiceInput';

type Step = 'branch' | 'services' | 'team';
type Branch = { name: string; address: string; phone: string; defaultOpenTime: string; defaultCloseTime: string };
type SetupData = {
  editable: boolean;
  branch?: Branch;
  services?: { ProID: number; ProName: string; SPrice1: number; DurationMinutes: number | null }[];
  employees?: TeamEmployee[];
  payrollAvailable?: boolean;
  bookingAvailable?: boolean;
  error?: string;
};

const endpoint = '/api/tenant/onboarding/setup-data';
const inputClass = 'w-full rounded-xl border border-white/15 bg-[#071018] px-3 py-3 text-sm text-white outline-none focus:border-cyan-300';
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-2.5 text-sm font-black text-slate-950 hover:bg-cyan-200 disabled:opacity-50';
const emptyBranch: Branch = { name: '', address: '', phone: '', defaultOpenTime: '', defaultCloseTime: '' };

export default function InlineSetupForm({ step, onSaved, onContinue }: { step: Step; onSaved: () => Promise<void>; onContinue?: () => void }) {
  const [data, setData] = useState<SetupData | null>(null);
  const [branch, setBranch] = useState(emptyBranch);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('30');
  const [job, setJob] = useState<string>(SETUP_JOBS[0]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const pending = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch(endpoint, { cache: 'no-store', credentials: 'include', signal });
    const next = (await res.json()) as SetupData;
    if (!res.ok) throw new Error(next.error || 'تعذر تحميل البيانات.');
    if (signal?.aborted) return;
    setData(next);
    if (next.branch) setBranch(next.branch);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(''); setSuccess('');
    try {
      const body = step === 'branch'
        ? { action: 'branch', address: branch.address, phone: branch.phone, defaultOpenTime: branch.defaultOpenTime, defaultCloseTime: branch.defaultCloseTime }
        : step === 'services'
          ? { action: 'service', name, price: Number(price), durationMinutes: Number(duration) }
          : { action: 'employee', name, job };
      const res = await fetch(endpoint, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await res.json() as { ok?: boolean; existing?: number; error?: string };
      if (!res.ok || !result.ok) throw new Error(result.error || 'تعذر الحفظ.');
      setSuccess(step === 'branch' ? 'تم حفظ بيانات الفرع.' : result.existing ? 'الاسم موجود بالفعل؛ لم تتم إضافة سجل مكرر.' : 'تمت الإضافة بنجاح.');
      if (step !== 'branch') { setName(''); setPrice(''); }
      try { await load(); } catch { setError('تم الحفظ لكن تعذر تحديث القائمة. حدّث الصفحة قبل إضافة بيانات أخرى.'); }
      await onSaved();
      if (step === 'branch' && onContinue) onContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر الحفظ.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  if (loading) return <p role="status" className="mt-7 flex items-center gap-2 text-sm text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> تحميل البيانات...</p>;
  if (!data?.editable) return error ? <div className="mt-6 rounded-xl border border-rose-400/20 p-4"><p role="alert" className="text-sm text-rose-300">{error}</p><button type="button" onClick={async () => { setLoading(true); setError(''); try { await load(); } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات.'); } finally { setLoading(false); } }} className="mt-3 rounded-lg border border-white/15 px-4 py-2 text-sm">إعادة المحاولة</button></div> : null;

  if (String(step) === 'team') return <SmartTeamSetup employees={data.employees ?? []} payrollAvailable={data.payrollAvailable === true} bookingAvailable={data.bookingAvailable === true} onSaved={async () => { await load(); await onSaved(); }} />;

  return (
    <div className="mt-7 space-y-4">
      <form onSubmit={save} className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
        <fieldset disabled={busy} className="space-y-4 disabled:opacity-70">
          {step === 'branch' ? <>
            <h2 className="font-bold">بيانات فرعك — {branch.name}</h2>
            <label className="block space-y-1.5 text-sm"><span>عنوان الفرع</span><input required maxLength={250} value={branch.address} onChange={e => setBranch(b => ({ ...b, address: e.target.value }))} className={inputClass} placeholder="الشارع، المنطقة، المدينة" /></label>
            <label className="block space-y-1.5 text-sm"><span>رقم الموبايل</span><input required type="tel" dir="ltr" maxLength={40} value={branch.phone} onChange={e => setBranch(b => ({ ...b, phone: e.target.value }))} className={inputClass} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5 text-sm"><span>الفتح</span><input required type="time" value={branch.defaultOpenTime} onChange={e => setBranch(b => ({ ...b, defaultOpenTime: e.target.value }))} className={inputClass} /></label>
              <label className="block space-y-1.5 text-sm"><span>القفل</span><input required type="time" value={branch.defaultCloseTime} onChange={e => setBranch(b => ({ ...b, defaultCloseTime: e.target.value }))} className={inputClass} /></label>
            </div>
          </> : <>
            <h2 className="font-bold">{step === 'services' ? 'أضف خدمة جديدة' : 'أضف موظف جديد'}</h2>
            {step === 'services' && <div className="flex flex-wrap gap-2">
              {['حلاقة شعر', 'حلاقة ذقن', 'تنظيف بشرة', 'تصفيف شعر'].map(item => <button key={item} type="button" onClick={() => { setName(item); setSuccess(''); }} className="rounded-full border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10">{item}</button>)}
            </div>}
            <label className="block space-y-1.5 text-sm"><span>{step === 'services' ? 'اسم الخدمة' : 'اسم الموظف'}</span><input required maxLength={200} value={name} onChange={e => setName(e.target.value)} className={inputClass} /></label>
            {step === 'services' ? <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5 text-sm"><span>السعر (ج.م)</span><input required type="number" min="0.01" max="1000000" step="0.01" value={price} onChange={e => setPrice(e.target.value)} className={inputClass} /></label>
              <label className="block space-y-1.5 text-sm"><span>المدة بالدقائق</span><input required type="number" min="5" max="600" step="1" value={duration} onChange={e => setDuration(e.target.value)} className={inputClass} /></label>
            </div> : <label className="block space-y-1.5 text-sm"><span>الوظيفة</span><select value={job} onChange={e => setJob(e.target.value)} className={inputClass}>{SETUP_JOBS.map(item => <option key={item} value={item}>{item}</option>)}</select><span className="block text-xs leading-6 text-slate-400">هيتم ربط الموظف بالفرع الحالي. جداول العمل والرواتب وحسابات الدخول تتظبط من الإدارة.</span></label>}
          </>}
          <button type="submit" className={buttonClass}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{busy ? 'جاري الحفظ...' : step === 'branch' ? (onContinue ? 'حفظ ومتابعة' : 'حفظ بيانات الفرع') : 'حفظ وإضافة'}</button>
        </fieldset>
        {success && <p role="status" className="flex items-center gap-2 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{success}</p>}
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      </form>
      {step === 'services' && !!data.services?.length && <div className="rounded-2xl border border-white/10 p-4">
        <h3 className="mb-2 text-sm font-bold">الخدمات المحفوظة</h3>
        {data.services.map(s => <div key={s.ProID} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 py-3 text-sm last:border-0"><span>{s.ProName}</span><span className="text-xs text-slate-400">{s.SPrice1} ج.م · {s.DurationMinutes ?? '—'} دقيقة</span></div>)}
      </div>}
      {step === 'team' && !!data.employees?.length && <div className="rounded-2xl border border-white/10 p-4">
        <h3 className="mb-2 text-sm font-bold">فريق الفرع الحالي</h3>
        {data.employees.map(e => <div key={e.EmpID} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 py-3 text-sm last:border-0"><span>{e.EmpName}</span><span className="text-xs text-slate-400">{e.Job}</span></div>)}
      </div>}
    </div>
  );
}
