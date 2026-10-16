'use client';

import { useMemo, useState } from 'react';
import SubscriptionTenantTable from './SubscriptionTenantTable';

export type SubscriptionCompany = {
  id: string; code: string; name: string; status: string;
  modules: { key: string; title: string; status: string | null; validUntilUtc: string | null }[];
};

export default function PlatformSubscriptionSearch({ companies, canManage }: { companies: SubscriptionCompany[]; canManage: boolean }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return companies.filter(company =>
      (!q || company.name.toLocaleLowerCase().includes(q) || company.code.toLocaleLowerCase().includes(q)) &&
      (filter === 'all' || (filter === 'active' ? company.status === 'active' : company.status !== 'active'))
    );
  }, [companies, query, filter]);
  return (
    <section className="mt-7" aria-label="استحقاقات الشركات">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="min-w-[230px] flex-1 text-xs text-slate-400">
          بحث باسم الشركة أو الكود
          <input type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="اسم الشركة أو كودها"
            className="mt-2 block w-full rounded-xl border border-white/15 bg-[#101a2c] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none" />
        </label>
        <label className="text-xs text-slate-400">
          حالة الشركة
          <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}
            className="mt-2 block rounded-xl border border-white/15 bg-[#101a2c] px-4 py-3 text-sm text-slate-100">
            <option value="all">كل الشركات</option>
            <option value="active">النشطة</option>
            <option value="inactive">غير النشطة</option>
          </select>
        </label>
        <span aria-live="polite" className="self-end pb-3 text-xs text-slate-400">{visible.length} من {companies.length} شركة</span>
      </div>
      {visible.length === 0 && <p className="rounded-2xl border border-white/10 bg-[#101a2c] p-7 text-sm text-slate-400">{companies.length ? 'لا توجد شركات مطابقة للبحث.' : 'لا توجد شركات مسجلة.'}</p>}
      <div className="space-y-5">
        {visible.map(company => (
          <article key={company.id} className="rounded-2xl border border-white/10 bg-[#101a2c] p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{company.name} <span className="text-sm font-normal text-slate-400">({company.code})</span></h2>
                <p dir="ltr" className="mt-1 text-left text-xs text-slate-500">{company.id}</p>
              </div>
              <span className={company.status === 'active' ? 'text-xs text-emerald-300' : 'text-xs text-amber-300'}>{company.status === 'active' ? 'شركة نشطة' : 'شركة غير نشطة'}</span>
            </div>
            <SubscriptionTenantTable tenantId={company.id} tenantName={company.name} tenantCode={company.code}
              modules={company.modules} canManage={canManage && company.status === 'active'} />
          </article>
        ))}
      </div>
    </section>
  );
}
