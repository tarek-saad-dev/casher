'use client';

import { useEffect, useMemo, useState } from 'react';

type Service = { ProID: number; ProName: string | null; ProNameAr: string | null; SPrice1: number | null };
type Employee = { empId: number; name: string };
type EmployeesResponse = { ok: boolean; employees?: Employee[]; code?: string };

export default function InvoiceDraft({ services }: { services: Service[] }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [employeesError, setEmployeesError] = useState(false);

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

  return (
    <section className="rounded-3xl border border-white/10 bg-[#101a2c] p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-xl font-black">مسودة فاتورة تفاعلية</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">اختار خدمات وموظف من بيانات شركتك. الحساب استرشادي فقط، ولا يتم حفظ أي بيانات.</p></div>
        <span className="rounded-full border border-amber-400/25 px-3 py-2 text-xs text-amber-300">معاينة بدون حفظ</span>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <label htmlFor="pos-service-search" className="mb-2 block text-sm font-semibold">البحث عن خدمة</label>
          <input id="pos-service-search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="اكتب اسم الخدمة" className="w-full rounded-xl border border-white/15 bg-[#080e1a] p-3 text-sm text-white outline-none focus:border-cyan-300" />
          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
            {available.length === 0 && <p className="p-4 text-sm text-slate-400">لا توجد خدمات مطابقة.</p>}
            {available.map(item => (
              <label key={item.ProID} className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 p-3 hover:border-cyan-300/40">
                <input type="checkbox" checked={selected.includes(item.ProID)}
                  onChange={e => setSelected(current => e.target.checked ? [...current, item.ProID] : current.filter(id => id !== item.ProID))}
                  className="size-4 accent-cyan-300" />
                <span className="min-w-0 flex-1 text-sm">{item.ProNameAr || item.ProName || 'خدمة'}</span>
                <span className="shrink-0 text-xs text-cyan-200">{item.SPrice1 == null ? 'سعر غير محدد' : money(Number(item.SPrice1))}</span>
              </label>
            ))}
          </div>
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
          <div className="rounded-2xl border border-white/10 bg-[#080e1a] p-5">
            <p className="text-sm font-bold">ملخص المسودة</p>
            <p className="mt-3 text-xs text-slate-400">الخدمات المختارة: {chosen.length}</p>
            <p className="mt-2 text-xs text-slate-400">الموظف: {employees.find(e => String(e.empId) === employeeId)?.name || 'لم يتم اختياره'}</p>
            <p className="mt-5 text-xs text-slate-400">إجمالي استرشادي قبل الخصومات والضرائب</p>
            <p className="mt-1 text-2xl font-black text-cyan-200" dir="ltr">{money(estimatedTotal)}</p>
            {chosen.some(item => item.SPrice1 == null) && <p className="mt-2 text-xs text-amber-300">بعض الخدمات بدون سعر، والإجمالي غير مكتمل.</p>}
          </div>
          <button type="button" disabled className="w-full cursor-not-allowed rounded-xl bg-slate-700 px-4 py-3 text-sm font-bold text-slate-300">
            حفظ الفاتورة — غير متاح بعد
          </button>
        </div>
      </div>
    </section>
  );
}
