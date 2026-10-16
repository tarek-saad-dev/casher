import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { listPlatformSubscriptions } from '@/platform/modules/platformSubscriptions';
import TenantDirectory from './TenantDirectory';

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
          <TenantDirectory companies={companies.map(company => ({
            tenantId: company.tenantId, tenantCode: company.tenantCode,
            tenantName: company.tenantName, tenantStatus: company.tenantStatus,
          }))} />
        )}
      </div>
    </main>
  );
}
