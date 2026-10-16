import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Building2, MapPin, ShieldCheck } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getPool, sql } from '@/lib/db';
import { resolveStaffTenantContextForRequest } from '@/platform/tenant/tenantContext';
import { requireTenantPermission } from '@/platform/access/tenantGrants';
import { DRVO_PERMISSIONS } from '@/platform/access/permissions';

export const dynamic = 'force-dynamic';

type Company = { TenantId: string; Code: string; Status: string };
type Location = { LocationId: string; BranchCode: string; Timezone: string; Status: string; LegacyBranchId: number | null };

async function loadCompany(user: { UserID: number; ActiveBranchID: number; TenantId?: string; MembershipId?: string }) {
  if (!user.TenantId || !user.MembershipId) return null;
  const db = await getPool();
  // Never use the session tenant ID alone as proof of access. Re-resolve the
  // user's live membership and active branch against the authoritative tables.
  const context = await resolveStaffTenantContextForRequest({
    userId: user.UserID,
    activeBranchId: user.ActiveBranchID,
    preferredTenantId: user.TenantId,
  }, { executor: db });
  if (context.membershipId.toLowerCase() !== user.MembershipId.toLowerCase()) return null;
  await requireTenantPermission(context, DRVO_PERMISSIONS.organizationRead, { executor: db });
  await requireTenantPermission(context, DRVO_PERMISSIONS.locationsRead, { executor: db });
  const tenant = await db.request()
    .input('tenantId', sql.UniqueIdentifier, context.tenantId)
    .query<Company>(`SELECT TenantId, Code, Status FROM dbo.Tenant WHERE TenantId = @tenantId AND Status = N'active'`);
  if (!tenant.recordset[0]) return null;
  const locations = await db.request()
    .input('tenantId', sql.UniqueIdentifier, context.tenantId)
    .query<Location>(`SELECT LocationId, BranchCode, Timezone, Status, LegacyBranchId FROM dbo.Location WHERE TenantId = @tenantId ORDER BY BranchCode`);
  return { company: tenant.recordset[0], locations: locations.recordset, activeLocationId: context.activeLocation.locationId };
}

export default async function CompaniesPage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const user = await getSession();
  if (!user) redirect('/login');

  let data: Awaited<ReturnType<typeof loadCompany>> = null;
  let unavailable = false;
  try {
    data = await loadCompany(user);
  } catch (error) {
    console.error('[drvo/companies] Unable to load tenant-scoped companies:', error instanceof Error ? error.name : 'unknown');
    unavailable = true;
  }

  return (
    <main dir="rtl" className="min-h-screen bg-[#080e1a] px-5 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/drvo/workspace" className="inline-flex items-center gap-2 text-sm text-cyan-300 hover:text-cyan-200"><ArrowRight className="size-4" /> العودة للوحة التحكم</Link>
        <div className="mt-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-cyan-400">DRVO ERP / ORGANIZATION</p>
            <h1 className="mt-3 text-3xl font-black">الشركات والفروع</h1>
            <p className="mt-3 text-sm leading-7 text-slate-400">عرض بيانات شركتك وفروعها من قاعدة البيانات المعزولة. التعديل والإضافة هيتفعّلوا بعد اعتماد الصلاحيات.</p>
          </div>
          <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-xs font-bold text-amber-300">STAGING · قراءة فقط</span>
        </div>
        {unavailable || !data ? (
          <section role="status" className="mt-8 rounded-2xl border border-amber-300/20 bg-[#101a2c] p-8">
            <h2 className="text-lg font-bold">بيانات الشركة غير متاحة حاليًا</h2>
            <p className="mt-3 text-sm text-slate-400">{unavailable ? 'تعذر التحقق من بيانات الشركة. حاول لاحقًا.' : 'لم يتم العثور على عضوية نشطة مرتبطة بالشركة والفرع الحاليين.'}</p>
          </section>
        ) : (
          <>
            <section className="mt-8 rounded-3xl border border-white/10 bg-[#101a2c] p-6 sm:p-8">
              <div className="flex items-start gap-4">
                <div className="grid size-14 place-items-center rounded-2xl bg-cyan-300/10 text-cyan-300"><Building2 className="size-7" /></div>
                <div className="min-w-0">
                  <p className="text-xs text-slate-400">الشركة الحالية</p>
                  <h2 className="mt-2 break-words text-2xl font-bold">{data.company.Code}</h2>
                  <p className="mt-2 inline-flex items-center gap-2 text-xs text-emerald-300"><ShieldCheck className="size-4" /> عضوية وصلاحيات عرض متحقق منها</p>
                </div>
              </div>
            </section>
            <section className="mt-8">
              <div className="mb-5 flex items-center justify-between gap-4">
                <h2 className="text-xl font-bold">الفروع <span className="mr-2 text-sm font-normal text-slate-500">({data.locations.length})</span></h2>
                <span className="text-xs text-slate-500">الفروع التابعة لشركتك فقط</span>
              </div>
              {data.locations.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-[#101a2c] p-7 text-sm text-slate-400">لا توجد فروع مسجلة للشركة.</div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.locations.map((location) => (
                    <article key={location.LocationId} className="rounded-2xl border border-white/10 bg-[#101a2c] p-6">
                      <div className="flex items-center justify-between gap-3">
                        <div className="grid size-11 place-items-center rounded-xl bg-cyan-300/10 text-cyan-300"><MapPin className="size-5" /></div>
                        <span className={`rounded-full px-3 py-1 text-[11px] ${location.Status === 'active' ? 'bg-emerald-300/10 text-emerald-300' : 'bg-slate-400/10 text-slate-400'}`}>{location.Status === 'active' ? 'نشط' : 'غير نشط'}</span>
                      </div>
                      <h3 className="mt-5 break-words text-lg font-bold">{location.BranchCode}</h3>
                      <p className="mt-2 text-xs text-slate-400">المنطقة الزمنية: {location.Timezone}</p>
                      {location.LocationId.toLowerCase() === data.activeLocationId.toLowerCase() && <p className="mt-4 text-xs font-semibold text-cyan-300">الفرع الحالي</p>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
        <p className="mt-10 border-t border-white/10 pt-5 text-xs text-slate-500">لا يتم إنشاء أو تعديل بيانات الشركات والفروع من هذه الصفحة.</p>
      </div>
    </main>
  );
}
