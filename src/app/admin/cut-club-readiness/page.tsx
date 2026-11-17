import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin, isAuthResult } from "@/lib/api-auth";
import { getPool } from "@/lib/db";
import {
  expectedProductionDbIsConfigured,
  readOperatorCashierMetadata,
  type CutClubCashierMetadataReport,
} from "@/lib/cut-club/cashierProductionPreflight";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = {
  title: "CUT CLUB — مراجعة الجاهزية",
  robots: { index: false, follow: false },
};

export default async function CutClubReadinessAdmin() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) notFound();

  const allowed = process.env.CUT_CLUB_PRODUCTION_METADATA_READ_ENABLED === "true";
  const expected = process.env.CUT_CLUB_METADATA_EXPECTED_DB;
  let report: CutClubCashierMetadataReport | null = null;
  if (allowed && expectedProductionDbIsConfigured(expected)) {
    try {
      report = await readOperatorCashierMetadata({
        pool: await getPool(),
        operatorExpectedDbName: expected,
      });
    } catch {
      // No DB errors or customer details are displayed to the browser.
    }
  }

  const checks = [
    { title: "تسجيل دخول العملاء", ready: false, why: "واتساب OTP وجلسات العملاء الخاصة لسه غير موصولة" },
    { title: "محفظة العميل الحقيقية", ready: false, why: "محتاجة ربط موثّق بحساب العميل وبيانات Casher" },
    { title: "شراء المكافآت", ready: false, why: "محتاجة اختبار قاعدة البيانات والتسوية المالية الفعلية" },
    { title: "استخدام القسيمة عند الكاشير", ready: false, why: "محتاجة مطابقة الفروع واختبارات الفاتورة وتفعيل مضبوط" },
  ];
  return (
    <main dir="rtl" className="mx-auto max-w-5xl space-y-6 px-4 py-8 text-foreground sm:px-8">
      <div className="space-y-2">
        <Link href="/income/pos" className="text-sm text-primary hover:underline">الرجوع للكاشير</Link>
        <h1 className="text-2xl font-bold sm:text-3xl">CUT CLUB — جاهزية العملاء والكاشير</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
          شاشة مراجعة للإدارة فقط. النتيجة لا تشغّل المكافآت، ولا تغيّر الأرصدة أو بيانات العملاء.
          عرض معلومات الهيكل فقط لا يعني إن النظام جاهز للإطلاق.
        </p>
      </div>
      <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
        <h2 className="font-semibold">الحالة: غير جاهز للإطلاق</h2>
        <p className="mt-2 text-sm leading-7">
          كل التغييرات الجديدة مراجعة فقط؛ لازم اختبار العميل والكاشير والفروع والفواتير على قاعدة بيانات متحقّق منها قبل تفعيل التشغيل.
        </p>
      </section>
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-7">
        <h2 className="mb-4 text-lg font-semibold">فحص جداول قاعدة البيانات</h2>
        {!allowed ? <p className="text-sm">الفحص مقفول افتراضيًا. المدير التقني لازم يعتمد صلاحية القراءة وإعداد قاعدة البيانات.</p> :
          !expectedProductionDbIsConfigured(expected) ? <p className="text-sm">اسم قاعدة البيانات المتوقع لسه غير معتمد.</p> :
            report === null ? <p className="text-sm">فحص الهيكل لم ينجح. لا يوجد أي تعديل على البيانات.</p> :
              <div className="space-y-3">
                <p className="text-sm font-semibold">{report.schemaCompatible ? "الأعمدة المطلوبة موجودة — ما زال فحص الملكية والتسويات مطلوبًا" : "فيه جداول أو أعمدة ناقصة يلزم مراجعتها"}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {report.checks.map(check => (
                    <div key={check.table} className="rounded-xl border border-border bg-background p-3 text-sm">
                      <p dir="ltr" className="font-mono font-semibold">{check.table}</p>
                      <p className="mt-1 text-muted-foreground">{check.found && check.missingColumns.length === 0 ? "الهيكل متوافق" : "يحتاج مراجعة"}</p>
                      {check.missingColumns.length > 0 ? <p className="mt-2 break-words text-xs">أعمدة ناقصة: {check.missingColumns.join("، ")}</p> : null}
                    </div>
                  ))}
                </div>
              </div>}
      </section>
      <section className="space-y-3 rounded-2xl border border-border bg-card p-5 sm:p-7">
        <h2 className="text-lg font-semibold">ما الذي يمنع تشغيل CUT CLUB للعملاء والكاشير؟</h2>
        {checks.map(x => (
          <div key={x.title} className="rounded-xl border border-border bg-background p-4">
            <h3 className="text-sm font-semibold">{x.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{x.why}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
