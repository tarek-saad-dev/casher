"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Search, TicketCheck, ShieldAlert, AlertTriangle, Loader2 } from "lucide-react";

interface SafeVoucher {
  inventoryId: number;
  customerName: string;
  itemName: string;
  itemType: string;
  serviceId: number | null;
  status: "ACTIVE" | "USED" | "EXPIRED" | "CANCELLED";
  expiresAt: string | null;
  usable: boolean;
  consumptionSupported: boolean;
}
interface Props {
  branchName: string;
  readEnabled: boolean;
  redemptionEnabled: boolean;
}
const badge: Record<SafeVoucher["status"], string> = {
  ACTIVE: "صالحة", USED: "تم استخدامها", EXPIRED: "منتهية", CANCELLED: "ملغاة",
};
const validCode = (value: string) => /^[A-Z0-9-]{6,100}$/.test(value);
export default function CashierCutClubClient({ branchName, readEnabled, redemptionEnabled }: Props) {
  const [code, setCode] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [voucher, setVoucher] = useState<SafeVoucher | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [applied, setApplied] = useState(false);

  const normalizeCode = (value: string) => value.trim().toUpperCase();
  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!readEnabled || !validCode(normalizeCode(code))) return;
    setBusy(true); setVoucher(null); setInvoiceId(""); setMsg(""); setApplied(false);
    try {
      const r = await fetch("/api/pos/cut-club/vouchers?code=" + encodeURIComponent(normalizeCode(code)), {
        credentials: "same-origin", cache: "no-store",
      });
      const data: unknown = await r.json();
      if (r.ok && data && typeof data === "object" && "ok" in data && data.ok === true && "voucher" in data) {
        setVoucher(data.voucher as SafeVoucher);
      } else {
        setMsg("القسيمة غير موجودة أو غير متاحة في الفرع الحالي.");
      }
    } catch { setMsg("تعذر الاتصال بالنظام. لم يتم تغيير أي قسيمة."); }
    finally { setBusy(false); }
  }

  async function consume() {
    if (!voucher || !redemptionEnabled || !voucher.usable ||
        !voucher.consumptionSupported || !/^\d{1,10}$/.test(invoiceId) ||
        !Number.isSafeInteger(Number(invoiceId)) || Number(invoiceId) <= 0 ||
        !validCode(normalizeCode(code))) return;
    setBusy(true); setMsg(""); setApplied(false);
    try {
      const r = await fetch("/api/pos/cut-club/redeem", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalizeCode(code), invoiceId: Number(invoiceId) }),
      });
      const data = await r.json() as { ok?: boolean; replayed?: boolean; error?: string };
      if (r.ok && data.ok) {
        setMsg(data.replayed ? "القسيمة مرتبطة بالفاتورة دي بالفعل — مفيش استخدام مكرر." :
          "تم تأكيد استخدام القسيمة على الفاتورة المحفوظة.");
        setApplied(true);
        setVoucher({ ...voucher, status: "USED", usable: false });
      } else setMsg(data.error || "لم يتم تسجيل استخدام القسيمة. راجع الفاتورة.");
    } catch { setMsg("حصل خطأ في الاتصال. راجع حالة القسيمة قبل أي إعادة محاولة."); }
    finally { setBusy(false); }
  }

  return (
    <main dir="rtl" className="mx-auto max-w-3xl space-y-6 p-4 text-foreground sm:p-8">
      <header className="space-y-3">
        <Link href="/income/pos" className="inline-flex text-sm text-primary underline-offset-4 hover:underline">الرجوع للكاشير</Link>
        <div className="flex flex-wrap items-center gap-3">
          <TicketCheck size={32} className="text-primary" />
          <div><h1 className="text-2xl font-bold">CUT CLUB — الكاشير</h1>
            <p className="text-sm text-muted-foreground">فحص القسائم وربط استخدامها بفواتير فعلية · الفرع: {branchName}</p></div>
        </div>
      </header>
      {!readEnabled ? (
        <section role="status" className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-5 text-sm leading-7">
          <ShieldAlert className="mb-2" size={22} />
          ميزة CUT CLUB الجديدة لسه مقفولة. استخدم الكاشير العادي لحين مراجعة قاعدة البيانات وصلاحيات الفرع واعتماد التشغيل.
        </section>
      ) : null}
      <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">١. افحص القسيمة</h2>
        <form onSubmit={lookup} className="flex flex-col gap-3 sm:flex-row">
          <label htmlFor="cut-voucher-code" className="sr-only">كود القسيمة</label>
          <input id="cut-voucher-code" autoComplete="off" value={code}
            onChange={e => { setCode(e.target.value); setVoucher(null); setInvoiceId(""); setMsg(""); setApplied(false); }}
            placeholder="اكتب أو امسح كود القسيمة" maxLength={100}
            className="min-w-0 flex-1 rounded-xl border border-border bg-background p-3" />
          <button type="submit" disabled={!readEnabled || busy || !validCode(normalizeCode(code))}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">
            {busy ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />} فحص القسيمة
          </button>
        </form>
      </section>
      {voucher ? (
        <section aria-label="تفاصيل القسيمة" className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">٢. تأكد من العميل والخدمة</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">اسم العميل</dt><dd className="mt-1 font-semibold">{voucher.customerName}</dd></div>
            <div><dt className="text-muted-foreground">الخدمة</dt><dd className="mt-1 font-semibold">{voucher.itemName}</dd></div>
            <div><dt className="text-muted-foreground">الحالة</dt><dd className="mt-1 font-semibold">{badge[voucher.status]}</dd></div>
            <div><dt className="text-muted-foreground">الصلاحية</dt><dd className="mt-1">{voucher.expiresAt ? new Date(voucher.expiresAt).toLocaleDateString("ar-EG") : "بدون تاريخ انتهاء مسجل"}</dd></div>
          </dl>
          {!voucher.consumptionSupported ? (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-6">
              <AlertTriangle size={18} className="shrink-0" /> نوع المكافأة ده لسه محتاج ربط مالي مع الفاتورة؛ مفيش استخدام أو خصم هيتم من هنا.
            </p>
          ) : (
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="font-semibold">٣. احفظ الفاتورة أولًا، وبعدها أكد الاستخدام</h3>
              <p className="text-sm leading-6 text-muted-foreground">مسموح فقط بالخدمة المجانية اللي ظهرت في الفاتورة بسعر نهائي صفر. لازم القسيمة تخص نفس العميل ونفس الفرع.</p>
              <label htmlFor="cut-invoice-id" className="block text-sm font-medium">رقم فاتورة البيع المحفوظة</label>
              <input id="cut-invoice-id" inputMode="numeric" autoComplete="off" value={invoiceId}
                onChange={e => setInvoiceId(e.target.value)} placeholder="رقم الفاتورة"
                className="w-full rounded-xl border border-border bg-background p-3" />
              <button type="button" onClick={consume} disabled={busy || !redemptionEnabled || !voucher.usable ||
                  !/^\d{1,10}$/.test(invoiceId) || Number(invoiceId) <= 0}
                className="rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">
                تأكيد استخدام الخدمة المجانية على الفاتورة
              </button>
              {!redemptionEnabled ? <p className="text-sm text-amber-500">التأكيد المالي مقفول لحين اعتماد الربط والاختبارات النهائية.</p> : null}
            </div>
          )}
        </section>
      ) : null}
      {msg ? <p role="status" className={"flex items-start gap-2 rounded-xl border p-4 text-sm leading-6 " +
        (applied ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10")}>
        {applied ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}{msg}</p> : null}
      <p className="text-xs leading-6 text-muted-foreground">القسيمة لا تتحول إلى «مستخدمة» بمجرد الفحص أو فتح الشاشة. أي استخدام فعلي يجب أن يرتبط بفواتير البيع المحفوظة، ويُسجّل مرة واحدة فقط.</p>
    </main>
  );
}
