import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getPool, sql } from '@/lib/db';
import { resolveUserTenantMembership } from '@/platform/tenant/tenantContext';
import { loadTenantPermissionActor } from '@/platform/access/tenantGrants';
import { canDrvo, DRVO_PERMISSIONS } from '@/platform/access/permissions';

export const dynamic = 'force-dynamic';

type Branch = { LocationId: string; BranchCode: string; BranchName: string | null; Status: string; Timezone: string };
type Member = { MembershipId: string; UserName: string | null; LoginName: string | null; Roles: string | null };
type Module = { ModuleKey: string; Status: string; ValidUntilUtc: Date | null };
type Tenant = { TenantId: string; Code: string; Name: string; Status: string };

export default async function MyCompanyPage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const session = await getSession();
  if (!session) redirect('/login');
  let model: { tenant: Tenant; branches: Branch[]; members: Member[]; modules: Module[]; grants: string[] } | null = null;
  let reason = 'لا يمكن تحميل مساحة الشركة الآن.';
  try {
    if (process.env.STAGING_SAFETY_ENFORCE !== 'true' ||
      process.env.STAGING_SAFETY_DB_NAME !== 'last132_agent' ||
      process.env.DB_NAME !== 'last132_agent' ||
      process.env.DB_DATABASE !== 'last132_agent' ||
      process.env.DB_USER !== 'drvo_agent') throw new Error('STAGING_ONLY');
    const db = await getPool();
    const identity = await db.request().query<{ name: string }>('SELECT DB_NAME() AS name');
    if (identity.recordset[0]?.name !== 'last132_agent') throw new Error('WRONG_DATABASE');

    // The tenant comes exclusively from the authenticated user's authoritative membership.
    // No tenant ID, query parameter, cookie or platform-admin override is accepted.
    const membership = await resolveUserTenantMembership({ userId: session.UserID }, { executor: db });
    const context = {
      kind: 'staff' as const, tenantId: membership.tenantId, tenantCode: membership.tenantCode,
      membershipId: membership.membershipId, userId: session.UserID,
      activeLocation: { locationId: '', legacyBranchId: 0, branchCode: '', timezone: '' },
    };
    const actor = await loadTenantPermissionActor(context, { executor: db });
    if (!canDrvo(actor, membership.tenantId, DRVO_PERMISSIONS.organizationRead)) {
      reason = 'الحساب ليس لديه صلاحية عرض بيانات الشركة.';
    } else {
      const t = await db.request().input('tenantId', sql.UniqueIdentifier, membership.tenantId)
        .query<Tenant>("SELECT TenantId, Code, Name, Status FROM dbo.Tenant WHERE TenantId = @tenantId AND Status = N'active'");
      const tenant = t.recordset[0];
      if (!tenant) throw new Error('TENANT_NOT_ACTIVE');
      const branches = canDrvo(actor, membership.tenantId, DRVO_PERMISSIONS.locationsRead)
        ? (await db.request().input('tenantId', sql.UniqueIdentifier, membership.tenantId)
          .query<Branch>('SELECT l.LocationId, l.BranchCode, b.BranchName, l.Status, l.Timezone FROM dbo.Location l LEFT JOIN dbo.TblBranch b ON b.BranchID = l.LegacyBranchId WHERE l.TenantId = @tenantId ORDER BY l.BranchCode')).recordset : [];
      const members = canDrvo(actor, membership.tenantId, DRVO_PERMISSIONS.membersRead)
        ? (await db.request().input('tenantId', sql.UniqueIdentifier, membership.tenantId)
          .query<Member>(`SELECT m.MembershipId, u.UserName, u.loginName AS LoginName,
            (SELECT STRING_AGG(CONVERT(nvarchar(max), r.DisplayName), N', ')
             FROM dbo.DrvoTenantRoleAssignment a
             JOIN dbo.DrvoTenantRole r ON r.TenantId = a.TenantId AND r.RoleId = a.RoleId AND r.IsActive = 1
             WHERE a.TenantId = m.TenantId AND a.MembershipId = m.MembershipId) AS Roles
            FROM dbo.TenantMembership m
            LEFT JOIN dbo.TblUser u ON u.UserID = m.LegacyUserId
            WHERE m.TenantId = @tenantId ORDER BY u.UserName`)).recordset : [];
      const modules = canDrvo(actor, membership.tenantId, DRVO_PERMISSIONS.modulesRead)
        ? (await db.request().input('tenantId', sql.UniqueIdentifier, membership.tenantId)
          .query<Module>('SELECT ModuleKey, Status, ValidUntilUtc FROM dbo.DrvoModuleEntitlement WHERE TenantId = @tenantId ORDER BY ModuleKey')).recordset : [];
      model = { tenant, branches, members, modules, grants: [...actor.grants] };
    }
  } catch (error) {
    console.error('[drvo/my-company] unavailable', error instanceof Error ? error.name : 'unknown');
    reason = 'تعذر تحديد شركة واحدة لهذا الحساب أو تحميل صلاحياته. لا يتم اختيار شركة افتراضية.';
  }
  return <main dir="rtl" className="h-full min-h-0 overflow-y-auto bg-[#080e1a] px-5 py-8 pb-20 text-slate-100 sm:px-8">
    <div className="mx-auto max-w-6xl">
      <Link href="/drvo/workspace" className="text-sm text-cyan-300">العودة إلى مساحة العمل</Link>
      <div className="mt-8"><p className="text-xs font-bold tracking-widest text-cyan-300">DRVO ERP / TENANT WORKSPACE</p>
        <h1 className="mt-2 text-3xl font-black">شركتي</h1>
        <p className="mt-3 text-sm text-slate-400">مساحة مستقلة لبيانات شركتك وصلاحيات حسابك — Staging</p></div>
      {!model ? <p role="alert" className="mt-8 rounded-2xl border border-amber-400/20 bg-[#101a2c] p-6 text-amber-200">{reason}</p> : <>
        <section className="mt-8 rounded-2xl border border-white/10 bg-[#101a2c] p-6">
          <h2 className="text-2xl font-bold">{model.tenant.Name}</h2>
          <p className="mt-2 text-sm text-slate-400">{model.tenant.Code} · {model.tenant.Status === 'active' ? 'نشطة' : model.tenant.Status}</p>
          <p className="mt-4 text-xs text-emerald-300">تم التحقق من العضوية والصلاحيات من قاعدة البيانات · {model.grants.length} صلاحية</p>
        </section>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            ['الفروع', model.grants.includes(DRVO_PERMISSIONS.locationsRead) ? String(model.branches.length) : 'غير مصرح'],
            ['أعضاء الفريق', model.grants.includes(DRVO_PERMISSIONS.membersRead) ? String(model.members.length) : 'غير مصرح'],
            ['استحقاقات الموديولات', model.grants.includes(DRVO_PERMISSIONS.modulesRead) ? String(model.modules.length) : 'غير مصرح'],
          ].map(([label, value]) => <div key={label} className="rounded-2xl border border-white/10 bg-[#101a2c] p-5"><p className="text-sm text-slate-400">{label}</p><p className="mt-3 text-2xl font-bold">{value}</p></div>)}
        </div>
        {model.grants.includes(DRVO_PERMISSIONS.locationsRead) && <section className="mt-6 rounded-2xl border border-white/10 bg-[#101a2c] p-6">
          <h2 className="text-xl font-bold">الفروع</h2><div className="mt-4 space-y-3">{model.branches.map(b => <div key={b.LocationId} className="flex flex-wrap justify-between gap-3 rounded-xl border border-white/10 p-4"><div><p className="font-semibold">{b.BranchName || b.BranchCode}</p><p className="mt-1 text-xs text-slate-400">{b.BranchCode} · {b.Timezone}</p></div><span className="text-sm text-slate-300">{b.Status}</span></div>)}</div>
        </section>}
        {model.grants.includes(DRVO_PERMISSIONS.membersRead) && <section className="mt-6 rounded-2xl border border-white/10 bg-[#101a2c] p-6">
          <h2 className="text-xl font-bold">الفريق والأدوار</h2><div className="mt-4 space-y-3">{model.members.map(m => <div key={m.MembershipId} className="flex flex-wrap justify-between gap-3 rounded-xl border border-white/10 p-4"><div><p className="font-semibold">{m.UserName || 'مستخدم'}</p><p className="mt-1 text-xs text-slate-400">{m.LoginName || '—'}</p></div><span className="text-sm text-cyan-200">{m.Roles || 'بدون دور DRVO'}</span></div>)}</div>
        </section>}
        {model.grants.includes(DRVO_PERMISSIONS.modulesRead) && <section className="mt-6 rounded-2xl border border-white/10 bg-[#101a2c] p-6">
          <h2 className="text-xl font-bold">الموديولات</h2><div className="mt-4 space-y-3">{model.modules.length ? model.modules.map(m => <div key={m.ModuleKey} className="flex justify-between gap-3 rounded-xl border border-white/10 p-4"><span>{m.ModuleKey}</span><span className="text-sm text-slate-400">{m.Status}</span></div>) : <p className="text-sm text-slate-400">لا توجد موديولات مفعّلة أو مسجلة لهذه الشركة.</p>}</div>
        </section>}
        <p className="mt-6 text-xs text-slate-500">عرض فقط. إدارة الاشتراكات التجارية تتم من حساب مسؤول المنصة، ولا يمنح دور owner صلاحية Platform Admin.</p>
      </>}
    </div>
  </main>;
}
