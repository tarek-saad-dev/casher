import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getPool, sql } from '@/lib/db';
import { loadPlatformPrincipal } from '@/platform/modules/platformAuthorityRepository';
import { listPlatformSubscriptions } from '@/platform/modules/platformSubscriptions';
import { DRVO_MODULES } from '@/platform/modules/registry';

export const dynamic = 'force-dynamic';

type LocationRow = { LocationId: string; BranchCode: string; Timezone: string; Status: string; LegacyBranchId: number | null };
type MemberRow = { MembershipId: string; LegacyUserId: number; UserName: string | null; LoginName: string | null };
type TenantRow = { TenantId: string; Code: string; Name: string; Status: string; DefaultTimezone: string };

export default async function PlatformTenantDetail({ params }: { params: Promise<{ tenantId: string }> }) {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const session = await getSession();
  if (!session) redirect('/login');
  const { tenantId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) notFound();
  let data: { tenant: TenantRow; locations: LocationRow[]; members: MemberRow[]; subscriptions: Awaited<ReturnType<typeof listPlatformSubscriptions>> } | null = null;
  let denied = false;
  try {
    // Platform identity is separate from the selected tenant's membership.
    const pool = await getPool();
    if (process.env.STAGING_SAFETY_ENFORCE !== 'true' ||
        process.env.STAGING_SAFETY_DB_NAME !== 'last132_agent' ||
        process.env.DB_NAME !== 'last132_agent' ||
        process.env.DB_DATABASE !== 'last132_agent' ||
        process.env.DB_USER !== 'drvo_agent') throw Error('STAGING_SAFETY_DENIED');
    const identity = await pool.request().query<{ name: string }>('SELECT DB_NAME() AS name');
    if (identity.recordset[0]?.name !== 'last132_agent') throw Error('STAGING_DATABASE_MISMATCH');
    const principal = await loadPlatformPrincipal(session.UserID, { executor: pool });
    if (!principal.active || !principal.grants.includes('platform.entitlements.read')) {
      denied = true;
    } else {
      const tenantResult = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
        .query<TenantRow>('SELECT TenantId, Code, Name, Status, DefaultTimezone FROM dbo.Tenant WHERE TenantId = @tenantId');
      const tenant = tenantResult.recordset[0];
      if (!tenant) notFound();
      const locations = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
        .query<LocationRow>('SELECT LocationId, BranchCode, Timezone, Status, LegacyBranchId FROM dbo.Location WHERE TenantId = @tenantId ORDER BY BranchCode');
      const members = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
        .query<MemberRow>(`SELECT m.MembershipId, m.LegacyUserId, u.UserName, u.loginName AS LoginName
          FROM dbo.TenantMembership AS m
          LEFT JOIN dbo.TblUser AS u ON u.UserID = m.LegacyUserId
          WHERE m.TenantId = @tenantId ORDER BY m.LegacyUserId`);
      const subscriptions = (await listPlatformSubscriptions(session.UserID)).filter(row => row.tenantId.toLowerCase() === tenantId.toLowerCase());
      data = { tenant, locations: locations.recordset, members: members.recordset, subscriptions };
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    if (!denied) console.error('[drvo/platform-tenant-detail] unavailable', error instanceof Error ? error.name : 'unknown');
  }
  return <main dir="rtl" className="h-full min-h-0 overflow-y-auto bg-[#080e1a] px-5 py-8 pb-16 text-slate-100 sm:px-8">
    <div className="mx-auto max-w-6xl">
      <Link href="/drvo/workspace/platform-tenants" className="text-sm text-cyan-300">العودة إلى دليل الشركات</Link>
      {!data ? <p role="alert" className="mt-8 rounded-2xl border border-rose-400/20 bg-[#101a2c] p-6">{denied ? 'ليس لديك صلاحية عرض بيانات المنصة.' : 'تعذر تحميل بيانات الشركة. لا يتم عرض بيانات جزئية.'}</p> : <>
        <header className="mt-8 flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs text-cyan-300">ملف الشركة / TENANT PROFILE</p>
            <h1 className="mt-2 text-3xl font-black">{data.tenant.Name}</h1>
            <p className="mt-3 text-sm text-slate-400">{data.tenant.Code} · {data.tenant.Status === 'active' ? 'نشطة' : 'غير نشطة'} · {data.tenant.DefaultTimezone}</p>
            <p dir="ltr" className="mt-2 text-left text-xs text-slate-500">{data.tenant.TenantId}</p>
          </div>
          <Link href="/drvo/workspace/subscriptions" className="rounded-xl border border-cyan-300/30 px-5 py-3 text-sm text-cyan-300">إدارة الاشتراكات</Link>
        </header>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[['الفروع', data.locations.length], ['المستخدمون', data.members.length], ['اشتراكات الموديولات', data.subscriptions.filter(item => item.moduleKey).length]].map(([label, value]) =>
            <div key={label} className="rounded-2xl border border-white/10 bg-[#101a2c] p-6"><p className="text-sm text-slate-400">{label}</p><p className="mt-3 text-3xl font-bold">{value}</p></div>)}
        </div>
        <section className="mt-7 rounded-2xl border border-white/10 bg-[#101a2c] p-6">
          <h2 className="text-xl font-bold">الفروع</h2>
          <div className="mt-4 space-y-3">{data.locations.map(branch => <div key={branch.LocationId} className="flex flex-wrap justify-between gap-2 rounded-xl border border-white/10 p-4">
            <div><p className="font-semibold">{branch.BranchCode}</p><p className="mt-1 text-xs text-slate-400">{branch.Timezone} · Branch ID: {branch.LegacyBranchId ?? '—'}</p></div><span className="text-sm text-slate-300">{branch.Status}</span>
          </div>)}{!data.locations.length && <p className="text-sm text-slate-400">لا توجد فروع.</p>}</div>
        </section>
        <section className="mt-7 rounded-2xl border border-white/10 bg-[#101a2c] p-6">
          <h2 className="text-xl font-bold">المستخدمون والمالك</h2>
          <div className="mt-4 space-y-3">{data.members.map(member => <div key={member.MembershipId} className="flex flex-wrap justify-between gap-2 rounded-xl border border-white/10 p-4">
            <div><p className="font-semibold">{member.UserName || 'مستخدم'}</p><p dir="ltr" className="mt-1 text-left text-xs text-slate-400">{member.LoginName || '—'}</p></div><span className="text-xs text-slate-500">User ID: {member.LegacyUserId}</span>
          </div>)}{!data.members.length && <p className="text-sm text-slate-400">لا توجد عضويات.</p>}</div>
          <p className="mt-4 text-xs text-slate-500">القائمة تعرض العضويات، ولا تفترض أن أول مستخدم هو المالك دون سجل دور صريح.</p>
        </section>
        <section className="mt-7 rounded-2xl border border-white/10 bg-[#101a2c] p-6">
          <h2 className="text-xl font-bold">حالة الموديولات</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{Object.values(DRVO_MODULES).map(module => {
            const item = data.subscriptions.find(row => row.moduleKey === module.key);
            return <div key={module.key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-4"><span>{module.title}</span><span className="text-sm text-slate-400">{item?.status ?? 'غير مشترك'}</span></div>;
          })}</div>
        </section>
        <p className="mt-6 text-xs text-slate-500">هذه الصفحة للعرض فقط. تعديل الفروع والمستخدمين يتطلب صلاحيات مستقلة ومسارات تدقيق قبل تفعيله.</p>
      </>}
    </div>
  </main>;
}
