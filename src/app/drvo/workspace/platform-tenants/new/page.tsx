import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getPool } from '@/lib/db';
import { loadPlatformPrincipal } from '@/platform/modules/platformAuthorityRepository';
import TenantCreateForm from './TenantCreateForm';

export const dynamic = 'force-dynamic';

export default async function NewPlatformTenantPage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const session = await getSession();
  if (!session) redirect('/login');
  let permitted = false;
  try {
    const pool = await getPool();
    const db = await pool.request().query<{ name: string }>('SELECT DB_NAME() AS name');
    if (process.env.STAGING_SAFETY_ENFORCE === 'true' &&
        process.env.DB_NAME === 'last132_agent' &&
        process.env.DB_DATABASE === 'last132_agent' &&
        process.env.DB_USER === 'drvo_agent' &&
        db.recordset[0]?.name === 'last132_agent') {
      const principal = await loadPlatformPrincipal(session.UserID, { executor: pool });
      permitted = principal.active && principal.userId === session.UserID &&
        principal.grants.includes('platform.entitlements.manage');
    }
  } catch { /* fail closed */ }
  return <main dir="rtl" className="h-full min-h-0 overflow-y-auto bg-[#080e1a] px-5 py-8 pb-16 text-slate-100 sm:px-8">
    <div className="mx-auto max-w-4xl">
      <Link href="/drvo/workspace/platform-tenants" className="text-sm text-cyan-300">العودة إلى دليل الشركات</Link>
      <h1 className="mt-8 text-3xl font-black">إنشاء شركة جديدة</h1>
      <p className="mt-3 text-sm text-slate-400">DRVO ERP — Staging فقط</p>
      {permitted ? <TenantCreateForm /> : <p role="alert" className="mt-8 rounded-xl border border-rose-400/30 p-5 text-rose-300">غير مصرح لك بإنشاء شركات المنصة.</p>}
    </div>
  </main>;
}
