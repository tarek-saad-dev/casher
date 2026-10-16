import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { listPlatformSubscriptions } from '@/platform/modules/platformSubscriptions';

export const dynamic = 'force-dynamic';

export default async function PlatformTenantsPage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const session = await getSession();
  if (!session) redirect('/login');
  let rows: Awaited<ReturnType<typeof listPlatformSubscriptions>> = [];
  let failed = false;
  try { rows = await listPlatformSubscriptions(session.UserID); }
  catch { failed = true; }
  const companies = Array.from(new Map(rows.map(row => [row.tenantId, row])).values());
  return (
    <main dir="rtl" className="h-full min-h-0 overflow-y-auto bg-[#080e1a] px-5 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/drvo/workspace" className="text-sm text-cyan-300">العودة للوحة التحكم</Link>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-black">دليل شركات المنصة</h1><Link href="/drvo/workspace/platform-tenants/new" className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950">+ إنشاء شركة</Link></div>
        <p className="mt-3 text-sm text-slate-400">Staging — عرض الشركات بصلاحية Platform Admin المستقلة</p>
        {failed ? <p role="alert" className="mt-8 rounded-xl border border-rose-400/30 p-5 text-rose-300">غير مصرح أو تعذر التحقق من بيانات الشركات.</p> : (
          <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10 bg-[#101a2c]">
            <table className="w-full min-w-[600px] text-right text-sm">
              <thead className="bg-white/5 text-slate-400"><tr><th className="p-4">الشركة</th><th className="p-4">الكود</th><th className="p-4">الحالة</th><th className="p-4">الاشتراكات</th></tr></thead>
              <tbody className="divide-y divide-white/10">{companies.map(company => (
                <tr key={company.tenantId}>
                  <td className="p-4 font-semibold">{company.tenantName}</td>
                  <td className="p-4 text-slate-400" dir="ltr">{company.tenantCode}</td>
                  <td className="p-4">{company.tenantStatus === 'active' ? 'نشطة' : 'غير نشطة'}</td>
                  <td className="p-4"><Link className="text-cyan-300 hover:underline" href="/drvo/workspace/subscriptions">إدارة الموديولات</Link></td>
                </tr>
              ))}</tbody>
            </table>
            {!companies.length && <p className="p-6 text-sm text-slate-400">لا توجد شركات مسجلة.</p>}
          </div>
        )}
      </div>
    </main>
  );
}
