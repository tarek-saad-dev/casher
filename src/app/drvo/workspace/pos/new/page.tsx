import InvoiceDraft from './InvoiceDraft';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, CheckCircle2, ClipboardList, LockKeyhole, ShieldCheck } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getPool, sql } from '@/lib/db';
import { authorizeDrvoPosOperationalRead } from '@/platform/pos/authorizePosRead';


export const dynamic = 'force-dynamic';

export default async function NewPosInvoicePage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  if (!await getSession()) redirect('/login');
  const access = await authorizeDrvoPosOperationalRead();
  let catalog: Array<{ ProID: number; ProName: string | null; ProNameAr: string | null; SPrice1: number | null }> = [];
  let catalogError = false;
  if (access.ok) {
    try {
      const db = await getPool();
      const result = await db.request()
        .input('tenantId', sql.UniqueIdentifier, access.context.tenantId)
        .input('locationId', sql.UniqueIdentifier, access.context.activeLocation.locationId)
        .input('branchId', sql.Int, access.context.activeLocation.legacyBranchId)
        .query<{ ProID: number; ProName: string | null; ProNameAr: string | null; SPrice1: number | null }>(`
          SELECT TOP (100) p.ProID, p.ProName, p.ProNameAr, p.SPrice1
          FROM dbo.TblPro AS p
          WHERE p.TenantId = @tenantId AND ISNULL(p.isDeleted, 0) = 0
            AND EXISTS (
              SELECT 1 FROM dbo.Location AS l
              JOIN dbo.Tenant AS t ON t.TenantId = l.TenantId AND t.Status = N'active'
              WHERE l.LocationId = @locationId AND l.TenantId = @tenantId
                AND l.LegacyBranchId = @branchId AND l.Status = N'active'
            )
          ORDER BY p.ProName, p.ProID
        `);
      catalog = result.recordset;
    } catch { catalogError = true; }
  }

  return (
    <main dir="rtl" className="fixed inset-0 z-40 h-[100dvh] w-full overflow-x-hidden overflow-y-auto overscroll-y-contain bg-[#080e1a] px-5 py-8 pb-20 text-slate-100 [scrollbar-gutter:stable] sm:px-9">
      <div className="mx-auto max-w-5xl space-y-7">
        <Link href="/drvo/workspace/pos" className="inline-flex items-center gap-2 text-sm text-cyan-300">
          <ArrowRight className="size-4" /> الرجوع للمبيعات
        </Link>
        <div className="rounded-3xl border border-white/10 bg-[#101a2c] p-7 sm:p-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            <LockKeyhole className="size-4" /> الحفظ غير متاح حاليًا
          </span>
          <h1 className="mt-5 text-3xl font-black">إنشاء فاتورة جديدة</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
            مسار البيع الجديد قيد التجهيز. لن يتم إرسال أو حفظ أي فاتورة قبل ربط كتالوج الخدمات
            والأسعار والموظفين المعتمدين بالفرع الحالي، وتفعيل معاملة الحفظ الآمنة.
          </p>
          {access.ok ? (
            <div className="mt-5 inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-200">
              <ShieldCheck className="size-5" /> الفرع الحالي: {access.context.activeLocation.branchCode}
            </div>
          ) : (
            <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
              لا توجد صلاحية للوصول لهذه الوحدة: {access.code}
            </p>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { title: 'اختيار الخدمات', detail: 'الخدمات والأسعار من كتالوج الفرع المعتمد', icon: ClipboardList },
            { title: 'العميل والموظف', detail: 'ربط العميل والموظف بالشركة والفرع', icon: ShieldCheck },
            { title: 'المراجعة والدفع', detail: 'إجمالي موثوق وحفظ دون تكرار', icon: CheckCircle2 },
          ].map((step, i) => (
            <section key={step.title} className="rounded-2xl border border-white/10 bg-[#101a2c] p-6">
              <step.icon className="size-7 text-cyan-300" />
              <p className="mt-5 text-xs text-slate-500">المرحلة {i + 1}</p>
              <h2 className="mt-2 text-lg font-bold">{step.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">{step.detail}</p>
            </section>
          ))}
        </div>
        {access.ok && !catalogError ? <InvoiceDraft services={catalog} /> : null}
        {access.ok ? (
          <section className="rounded-3xl border border-white/10 bg-[#101a2c] p-6 sm:p-8">
            <h2 className="text-xl font-bold">كتالوج خدمات شركتك</h2>
            <p className="mt-2 text-sm leading-7 text-slate-400">الأسعار استرشادية من بيانات الشركة. إتاحة الخدمات للفرع والحساب النهائي لم يتم اعتمادهم للبيع بعد.</p>
            {catalogError ? <p className="mt-5 text-sm text-rose-300">تعذر تحميل الكتالوج.</p> : catalog.length === 0 ? <p className="mt-5 rounded-xl border border-white/10 p-5 text-sm text-slate-400">لا توجد خدمات مسجلة للشركة حاليًا. يلزم إضافة خدمات قبل بدء البيع.</p> : (
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {catalog.map(item => (
                  <div key={item.ProID} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                    <p className="text-sm font-bold">{item.ProNameAr || item.ProName || `خدمة #${item.ProID}`}</p>
                    {item.ProNameAr && item.ProName ? <p className="mt-1 text-xs text-slate-400">{item.ProName}</p> : null}
                    <p className="mt-3 text-sm text-cyan-200">{item.SPrice1 == null ? 'السعر غير محدد' : `${Number(item.SPrice1).toLocaleString('ar-EG')} ج.م`}</p>
                    <p className="mt-2 text-[11px] text-amber-300">غير متاحة للإضافة للفاتورة بعد</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
        <div className="rounded-2xl border border-amber-400/20 p-5 text-sm text-amber-200">
          لا توجد فاتورة محفوظة. لن نستخدم بيانات أو أسعارًا افتراضية لتجربة البيع.
        </div>
      </div>
    </main>
  );
}
