'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Service = { ProID: number; ProName: string | null; ProNameAr: string | null; SPrice1: number | null };
type Employee = { empId: number; name: string };
type EmployeesResponse = { ok: boolean; employees?: Employee[]; code?: string };
type Quote = { ok: boolean; code?: string; lines?: Array<{ proId: number; name: string; unitPrice: number }>; indicativeTotal?: number; employee?: { id: number; name: string }; quoteOnly?: boolean };

export default function InvoiceDraft({ services }: { services: Service[] }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [employeesError, setEmployeesError] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const revisionRef = useRef(0);

  useEffect(() => {
    let alive = true;
    fetch('/api/drvo/pos/employees', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw Error('EMPLOYEE_READ_FAILED');
        return await response.json() as EmployeesResponse;
      })
      .then(data => {
        if (!data.ok) throw Error('EMPLOYEE_READ_FAILED');
        if (alive) setEmployees(data.employees ?? []);
      })
      .catch(() => { if (alive) setEmployeesError(true); });
    return () => { alive = false; };
  }, []);

  const available = useMemo(() => services.filter(item =>
    (item.ProNameAr || item.ProName || '').toLocaleLowerCase().includes(search.toLocaleLowerCase())
  ), [services, search]);
  const chosen = useMemo(() => services.filter(item => selected.includes(item.ProID)), [services, selected]);
  const estimatedTotal = chosen.reduce((sum, item) => sum + Number(item.SPrice1 || 0), 0);
  const money = (value: number) => new Intl.NumberFormat('ar-EG').format(value) + ' ج.م';

  useEffect(() => { setQuote(null); revisionRef.current += 1; }, [selected, employeeId]);

  async function calculateQuote() {
    if (!employeeId || selected.length === 0) return;
    setQuoteLoading(true);
    setQuote(null);
    setStep(3);
    const revision = revisionRef.current;
    try {
      const response = await fetch('/api/drvo/pos/quote', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-drvo-pos-quote-intent': '1' },
        body: JSON.stringify({ employeeId: Number(employeeId), serviceIds: selected }),
      });
      const result = await response.json() as Quote;
      if (revision === revisionRef.current) setQuote(response.ok ? result : { ok: false, code: result.code || 'QUOTE_FAILED' });
    } catch { if (revision === revisionRef.current) setQuote({ ok: false, code: 'NETWORK_ERROR' }); }
    finally { if (revision === revisionRef.current) setQuoteLoading(false); }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-[#101a2c] p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-xl font-black">مسودة فاتورة تفاعلية</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">اختار خدمات وموظف من بيانات شركتك. الحساب استرشادي فقط، ولا يتم حفظ أي بيانات.</p></div>
        <span className="rounded-full border border-amber-400/25 px-3 py-2 text-xs text-amber-300">معاينة بدون حفظ</span>
      </div>
      <nav aria-label="مراحل المسودة" className="mt-6 flex flex-wrap gap-2">{([1, 2, 3] as const).map((number) => <button type="button" key={number} onClick={() => setStep(number)} className={`rounded-xl border px-4 py-2 text-xs font-semibold ${step === number ? 'border-cyan-300 bg-cyan-300/10 text-cyan-200' : 'border-white/10 text-slate-400'}`}>{number === 1 ? '١ · الخدمات' : number === 2 ? '٢ · الموظف والعميل' : '٣ · التسعير والمراجعة'}</button>)}</nav>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className={step === 1 ? '' : 'hidden lg:block'}>
          <label htmlFor="pos-service-search" className="mb-2 block text-sm font-semibold">البحث عن خدمة</label>
          <input id="pos-service-search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="اكتب اسم الخدمة" className="w-full rounded-xl border border-white/15 bg-[#080e1a] p-3 text-sm text-white outline-none focus:border-cyan-300" />
          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
            {available.length === 0 && <p className="p-4 text-sm text-slate-400">لا توجد خدمات مطابقة.</p>}
            {available.map(item => (
              <label key={item.ProID} className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 p-3 hover:border-cyan-300/40">
                <input type="checkbox" disabled={item.SPrice1 == null || selected.length >= 20 && !selected.includes(item.ProID)} checked={selected.includes(item.ProID)}
                  onChange={e => setSelected(current => e.target.checked ? [...current, item.ProID] : current.filter(id => id !== item.ProID))}
                  className="size-4 accent-cyan-300" />
                <span className="min-w-0 flex-1 text-sm">{item.ProNameAr || item.ProName || 'خدمة'}</span>
                <span className="shrink-0 text-xs text-cyan-200">{item.SPrice1 == null ? 'سعر غير محدد' : money(Number(item.SPrice1))}</span>
              </label>
            ))}
          </div>
          <button type="button" onClick={() => setStep(2)} disabled={selected.length === 0} className="mt-4 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 disabled:opacity-40">التالي: الموظف والعميل</button>
        </div>
        <div className="space-y-5">
          <div>
            <label htmlFor="pos-employee" className="mb-2 block text-sm font-semibold">الموظف بالفرع</label>
            <select id="pos-employee" value={employeeId} onChange={e => setEmployeeId(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-[#080e1a] p-3 text-sm text-white">
              <option value="">اختار موظف</option>
              {employees.map(employee => <option key={employee.empId} value={employee.empId}>{employee.name}</option>)}
            </select>
            {employeesError && <p role="alert" className="mt-2 text-xs text-rose-300">تعذر تحميل موظفي الفرع.</p>}
            {!employeesError && employees.length === 0 && <p className="mt-2 text-xs text-amber-300">لا توجد تعيينات موظفين نشطة للفرع حاليًا.</p>}
          </div>
          <div className="space-y-3 rounded-2xl border border-white/10 bg-[#080e1a] p-5">
            <p className="text-sm font-bold">بيانات العميل والدفع (مسودة محلية)</p>
            <label className="block text-xs text-slate-400" htmlFor="pos-customer-name">اسم العميل</label>
            <input id="pos-customer-name" value={customerName} onChange={e => setCustomerName(e.target.value.slice(0, 100))} placeholder="اسم العميل (اختياري)" className="w-full rounded-xl border border-white/15 bg-[#101a2c] p-3 text-sm text-white" />
            <label className="block text-xs text-slate-400" htmlFor="pos-customer-phone">رقم العميل</label>
            <input id="pos-customer-phone" type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value.slice(0, 20))} placeholder="رقم الموبايل (اختياري)" className="w-full rounded-xl border border-white/15 bg-[#101a2c] p-3 text-sm text-white" />
            <label className="block text-xs text-slate-400" htmlFor="pos-payment">طريقة الدفع المبدئية</label>
            <select id="pos-payment" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as 'cash' | 'card')} className="w-full rounded-xl border border-white/15 bg-[#101a2c] p-3 text-sm text-white"><option value="cash">نقدي</option><option value="card">بطاقة</option></select>
            <p className="text-xs text-amber-300">البيانات دي مش بتتبعت مع طلب التسعير ومش بتتحفظ.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#080e1a] p-5">
            <p className="text-sm font-bold">ملخص المسودة</p>
            <p className="mt-3 text-xs text-slate-400">الخدمات المختارة: {chosen.length}</p>
            <p className="mt-2 text-xs text-slate-400">الموظف: {employees.find(e => String(e.empId) === employeeId)?.name || 'لم يتم اختياره'}</p>
            <p className="mt-5 text-xs text-slate-400">إجمالي استرشادي قبل الخصومات والضرائب</p>
            <p className="mt-1 text-2xl font-black text-cyan-200" dir="ltr">{money(estimatedTotal)}</p>
            {chosen.some(item => item.SPrice1 == null) && <p className="mt-2 text-xs text-amber-300">بعض الخدمات بدون سعر، والإجمالي غير مكتمل.</p>}
          </div>
          <button type="button" onClick={() => setStep(3)} disabled={!employeeId || selected.length === 0} className="w-full rounded-xl border border-cyan-300/30 px-4 py-3 text-sm font-semibold text-cyan-200 disabled:opacity-40">التالي: مراجعة السعر</button>
          <button type="button" onClick={calculateQuote} disabled={quoteLoading || !employeeId || chosen.length === 0 || chosen.some(item => item.SPrice1 == null)} className="w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{quoteLoading ? 'جاري التسعير...' : 'احسب السعر من السيرفر'}</button>
          {quote && <div role="status" className="rounded-xl border border-white/15 bg-[#080e1a] p-4 text-sm">{quote.ok ? <><p className="font-bold text-emerald-300">تم التحقق من الخدمات والموظف وتسعير المسودة من السيرفر</p><div className="mt-3 space-y-2">{quote.lines?.map(line => <div key={line.proId} className="flex items-center justify-between gap-3 border-b border-white/10 pb-2 text-xs"><span>{line.name}</span><span dir="ltr" className="text-cyan-200">{money(line.unitPrice)}</span></div>)}</div><p className="mt-3 text-xl font-black text-cyan-200" dir="ltr">{money(Number(quote.indicativeTotal || 0))}</p><p className="mt-2 text-xs text-amber-300">سعر استرشادي فقط؛ إتاحة الخدمة للفرع والضرائب لم تُعتمد بعد.</p></> : <p className="text-rose-300">تعذر حساب المسودة: {quote.code}</p>}</div>}
          <button type="button" disabled className="w-full cursor-not-allowed rounded-xl bg-slate-700 px-4 py-3 text-sm font-bold text-slate-300">
            حفظ الفاتورة — غير متاح بعد
          </button>
        </div>
      </div>
    </section>
  );
}
