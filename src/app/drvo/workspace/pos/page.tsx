import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, ReceiptText, ShieldCheck, Wallet } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getPool, sql } from '@/lib/db';
import { authorizeDrvoPosOperationalRead } from '@/platform/pos/authorizePosRead';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Sale = { invID: number; invDate: Date; grandTotal: number; paidAmount: number };

export default async function DrvoPosPage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const session = await getSession();
  if (!session) redirect('/login');

  const access = await authorizeDrvoPosOperationalRead();
  let sales: Sale[] = [];
  let loadFailed = false;
  if (access.ok) {
    try {
      const db = await getPool();
      const result = await db.request()
        .input('branchId', sql.Int, access.context.activeLocation.legacyBranchId)
        .input('tenantId', sql.UniqueIdentifier, access.context.tenantId)
        .input('locationId', sql.UniqueIdentifier, access.context.activeLocation.locationId)
        .query<Sale>(`
          SELECT TOP (10) h.invID, h.invDate,
            ISNULL(h.GrandTotal, 0) AS grandTotal,
            ISNULL(h.PayCash, 0) + ISNULL(h.PayVisa, 0) AS paidAmount
          FROM dbo.TblinvServHead AS h
          JOIN dbo.Location AS l
            ON l.LegacyBranchId = h.BranchID
            AND l.LocationId = @locationId
            AND l.TenantId = @tenantId
            AND l.Status = N'active'
          WHERE h.BranchID = @branchId AND h.invType = N'مبيعات'
          ORDER BY h.invDate DESC, h.invID DESC
        `);
      sales = result.recordset;
    } catch {
      loadFailed = true;
    }
  }

  const money = (value: number) => new Intl.NumberFormat('ar-EG', {
    style: 'currency', currency: 'EGP', maximumFractionDigits: 2,
  }).format(value);
  const date = (value: Date) => new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo',
  }).format(new Date(value));
  const total = sales.reduce((sum, row) => sum + Number(row.grandTotal || 0), 0);
  const paid = sales.reduce((sum, row) => sum + Number(row.paidAmount || 0), 0);

  return (
    <main dir="rtl" className="min-h-screen bg-[#080e1a] px-5 py-8 text-slate-100 sm:px-9">
      <div className="mx-auto max-w-6xl space-y-7">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/drvo/workspace" className="inline-flex items-center gap-2 text-sm text-cyan-300">
              <ArrowRight className="size-4" /> مساحة العمل
            </Link>
            <h1 className="mt-4 text-3xl font-black">المبيعات ونقاط البيع</h1>
            <p className="mt-2 text-sm text-slate-400">مبيعات الفرع الحالي فقط — بيئة تجريبية</p>
          </div>
          <Link href="/drvo/workspace/pos/new" className="rounded-full border border-amber-400/25 bg-amber-400/10 px-4 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-400/15">
            تجهيز فاتورة جديدة — الحفظ مقفول
          </Link>
        </header>

        {!access.ok ? (
          <section className="rounded-3xl border border-amber-400/20 bg-[#101a2c] p-8">
            <ShieldCheck className="size-9 text-amber-300" />
            <h2 className="mt-4 text-xl font-bold">الوصول للمبيعات غير متاح</h2>
            <p className="mt-2 text-sm text-slate-300">تحتاج اشتراك POS فعال وصلاحية pos.read في شركتك.</p>
            <p className="mt-4 font-mono text-xs text-slate-500">{access.code}</p>
          </section>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-emerald-300">
                الاشتراك وصلاحية القراءة متاحان
              </span>
              <span className="rounded-full border border-white/10 px-3 py-2 text-slate-300">
                الفرع: {access.context.activeLocation.branchCode}
              </span>
              <span className="rounded-full border border-white/10 px-3 py-2 text-slate-300">قراءة فقط</span>
            </div>

            {loadFailed ? (
              <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">
                تعذر تحميل المبيعات حاليًا. حاول مرة أخرى لاحقًا.
              </p>
            ) : null}

            <section className="grid gap-4 sm:grid-cols-3" aria-label="ملخص الفواتير المعروضة">
              {[
                { label: 'عدد الفواتير المعروضة', value: String(sales.length), icon: ReceiptText },
                { label: 'إجمالي آخر الفواتير', value: money(total), icon: Wallet },
                { label: 'المدفوع بآخر الفواتير', value: money(paid), icon: ShieldCheck },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-[#101a2c] p-5">
                  <div className="flex items-center justify-between text-sm text-slate-400">
                    <span>{label}</span><Icon className="size-5 text-cyan-300" />
                  </div>
                  <p className="mt-5 text-2xl font-black">{value}</p>
                </div>
              ))}
            </section>

            <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#101a2c]">
              <div className="border-b border-white/10 p-6">
                <h2 className="text-lg font-bold">آخر 10 فواتير</h2>
                <p className="mt-1 text-xs text-slate-400">الإجماليات تخص الفواتير المعروضة فقط، وليست إجمالي اليوم.</p>
              </div>
              {!loadFailed && sales.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-16 text-center">
                  <ReceiptText className="size-12 text-slate-500" />
                  <h3 className="mt-4 text-lg font-bold">لا توجد فواتير حاليًا</h3>
                  <p className="mt-2 text-sm text-slate-400">الفرع التجريبي لا يحتوي على مبيعات للعرض حتى الآن.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-right text-sm">
                    <thead className="bg-white/5 text-xs text-slate-400">
                      <tr><th className="p-4">الفاتورة</th><th className="p-4">التاريخ</th><th className="p-4">الإجمالي</th><th className="p-4">المدفوع</th></tr>
                    </thead>
                    <tbody>
                      {sales.map(row => (
                        <tr key={row.invID} className="border-t border-white/10">
                          <td className="p-4 font-bold">#{row.invID}</td>
                          <td className="p-4 text-slate-300">{date(row.invDate)}</td>
                          <td className="p-4">{money(Number(row.grandTotal))}</td>
                          <td className="p-4">{money(Number(row.paidAmount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
