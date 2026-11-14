import { Download, MonitorCheck } from 'lucide-react';

export const PRINT_AGENT_V2_SETUP_FILE = '/downloads/CUT_Salon_Print_Agent_V2_Setup.cmd';

/** Always available: downloading this file does not invoke Windows commands from the browser. */
export default function PrintAgentInstallerDownload() {
  return (
    <section data-testid="print-agent-v2-installer" className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <MonitorCheck className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-bold text-foreground">تثبيت أو إصلاح برنامج الطباعة V2</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              من كمبيوتر Windows المتوصل بالطابعة: نزّل الملف، افتحه بدبل كليك، واتبع الرسائل.
              مش محتاج تكتب أوامر PowerShell، والملف مش هيطبع فواتير أثناء التثبيت.
            </p>
          </div>
        </div>
        <a
          href={PRINT_AGENT_V2_SETUP_FILE}
          download="CUT_Salon_Print_Agent_V2_Setup.cmd"
          data-testid="print-agent-v2-installer-download"
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-bold text-background transition-opacity hover:opacity-85"
        >
          <Download className="size-4" aria-hidden="true" />
          تحميل ملف التثبيت والإصلاح لـ Windows
        </a>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        يجب وجود Node.js 22 أو أحدث وتعريف الطابعة على الجهاز. بعد نجاح التثبيت، اختبر ورقة واحدة وتأكد من خروجها فعليًا.
      </p>
    </section>
  );
}
