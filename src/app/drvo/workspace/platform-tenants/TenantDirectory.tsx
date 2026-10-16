'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

export type DirectoryCompany = { tenantId: string; tenantCode: string; tenantName: string; tenantStatus: string };

export default function TenantDirectory({ companies }: { companies: DirectoryCompany[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const visible = useMemo(() => companies.filter(company => {
    const q = query.trim().toLocaleLowerCase();
    return (!q || company.tenantName.toLocaleLowerCase().includes(q) || company.tenantCode.toLocaleLowerCase().includes(q)) &&
      (status === 'all' || (status === 'active' ? company.tenantStatus === 'active' : company.tenantStatus !== 'active'));
  }), [companies, query, status]);
  return <>
    <div className="mt-7 flex flex-wrap items-end gap-4">
      <label className="min-w-[230px] flex-1 text-xs text-slate-400">بحث باسم الشركة أو الكود
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث عن شركة"
          className="mt-2 block w-full rounded-xl border border-white/15 bg-[#101a2c] px-4 py-3 text-sm text-slate-100 focus:border-cyan-300 focus:outline-none" />
      </label>
      <label className="text-xs text-slate-400">الحالة
        <select value={status} onChange={event => setStatus(event.target.value)}
          className="mt-2 block rounded-xl border border-white/15 bg-[#101a2c] px-4 py-3 text-sm text-slate-100">
          <option value="all">كل الشركات</option><option value="active">النشطة</option><option value="inactive">غير النشطة</option>
        </select>
      </label>
      <span aria-live="polite" className="pb-3 text-xs text-slate-400">{visible.length} من {companies.length} شركة</span>
    </div>
    <div className="mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-[#101a2c]">
      <table className="w-full min-w-[600px] text-right text-sm">
        <thead className="bg-white/5 text-slate-400"><tr><th className="p-4">الشركة</th><th className="p-4">الكود</th><th className="p-4">الحالة</th><th className="p-4">الاشتراكات</th></tr></thead>
        <tbody className="divide-y divide-white/10">{visible.map(company => <tr key={company.tenantId}>
          <td className="p-4 font-semibold"><Link href={`/drvo/workspace/platform-tenants/${company.tenantId}`} className="text-cyan-200 hover:underline">{company.tenantName}</Link></td>
          <td className="p-4 text-slate-400" dir="ltr">{company.tenantCode}</td>
          <td className="p-4">{company.tenantStatus === 'active' ? 'نشطة' : 'غير نشطة'}</td>
          <td className="p-4"><Link className="text-cyan-300 hover:underline" href="/drvo/workspace/subscriptions">إدارة الموديولات</Link></td>
        </tr>)}</tbody>
      </table>
      {!visible.length && <p className="p-6 text-sm text-slate-400">{companies.length ? 'لا توجد نتائج مطابقة.' : 'لا توجد شركات مسجلة.'}</p>}
    </div>
  </>;
}
