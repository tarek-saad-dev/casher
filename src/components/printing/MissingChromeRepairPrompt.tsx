'use client';

import { Download, Wrench } from 'lucide-react';
import type { PrintErrorCode } from '@/lib/localPrintClient';

export const CHROME_REPAIR_DOWNLOAD = '/downloads/Repair-CUT-Print-Chrome.cmd';

export function shouldShowChromeRepair(errorCode: PrintErrorCode | null | undefined): boolean {
  // Do not offer a browser download for printer, CORS, network or unknown errors.
  return errorCode === 'BROWSER_MISSING';
}

/** Only rendered when the local printer service reports missing Puppeteer Chrome. */
export default function MissingChromeRepairPrompt({
  errorCode,
}: {
  errorCode: PrintErrorCode | null | undefined;
}) {
  if (!shouldShowChromeRepair(errorCode)) return null;

  return (
    <div
      role="alert"
      data-testid="missing-chrome-print-repair"
      className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
      dir="rtl"
    >
      <div className="flex items-start gap-2">
        <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-bold">تم تحديد المشكلة: Chrome الخاص بطباعة الفواتير غير موجود.</p>
          <p className="mt-1 leading-relaxed">
            برنامج CUT Print Agent شغال، لكن تنقصه نسخة Chrome المستخدمة لتجهيز صورة الفاتورة.
            حمّل ملف الإصلاح على نفس كمبيوتر الكاشير وافتحه بدبل كليك.
          </p>
          <a
            href={CHROME_REPAIR_DOWNLOAD}
            download="Repair-CUT-Print-Chrome.cmd"
            data-testid="invoice-missing-chrome-download"
            className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2 font-semibold text-background transition-opacity hover:opacity-85"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            تحميل إصلاح Chrome للطباعة
          </a>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            اضغط Run إذا طلب Windows تأكيد تشغيل الملف الموثوق من Casher.
            بعد ظهور SUCCESS، ارجع وجرب ورقة اختبار واحدة. الإصلاح لا يعيد طباعة الفواتير تلقائيًا.
          </p>
        </div>
      </div>
    </div>
  );
}
