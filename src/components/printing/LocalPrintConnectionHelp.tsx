'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2, CircleHelp, ClipboardCopy, Download, ExternalLink,
  Loader2, Monitor, Printer, RefreshCw, TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  PRINT_SERVICE_URL, getLocalAgentHealth, REQUIRED_AGENT_VERSION, type PrintErrorCode,
} from '@/lib/localPrintClient';

export function isLocalAgentConnectionError(code: PrintErrorCode | null | undefined): boolean {
  return code === 'SERVICE_UNAVAILABLE' || code === 'NETWORK_ERROR'
    || code === 'CORS_BLOCKED' || code === 'TIMEOUT';
}

type Props = {
  /** Never reprints a receipt; only GET /health, plus optional settings refresh. */
  onReconnect?: () => void | Promise<void>;
  errorCode?: PrintErrorCode | null;
  compact?: boolean;
};

type CheckState = 'idle' | 'checking' | 'connected' | 'disconnected' | 'outdated';
type PrinterLocation = 'this-device' | 'another-device';

const TASK_NAME = 'CUT Salon Print Agent';
const START_COMMAND = "Start-ScheduledTask -TaskName 'CUT Salon Print Agent'";
const INSTALLER_URL = '/downloads/Install-CUT-Print-Agent.ps1';

export default function LocalPrintConnectionHelp({ onReconnect, errorCode, compact = false }: Props) {
  const [checkState, setCheckState] = useState<CheckState>('idle');
  const [printerLocation, setPrinterLocation] = useState<PrinterLocation>('this-device');
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function checkConnection() {
    if (checkState === 'checking') return;
    setCheckState('checking');
    let status: CheckState = 'disconnected';
    try {
      const health = await getLocalAgentHealth(2500);
      status = health.version === REQUIRED_AGENT_VERSION ? 'connected' : 'outdated';
    } catch { /* Browser CORS/LNA and offline Agent both fail fetch. */ }
    setCheckState(status);
    if (status === 'connected' && onReconnect) {
      try { await onReconnect(); }
      catch { /* This is not printer readiness; settings errors remain visible separately. */ }
    }
  }

  async function copyStartCommand() {
    try {
      await navigator.clipboard.writeText(START_COMMAND);
      setCopied(true);
    } catch {
      setExpanded(true);
    }
  }

  return (
    <section data-testid="local-print-help" dir="rtl" role="region"
      aria-label="إصلاح اتصال خدمة الطباعة المحلية"
      className="rounded-2xl border border-amber-500/35 bg-amber-500/5 p-4 text-foreground sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
          <Printer className="size-5" aria-hidden/>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold sm:text-base">خدمة الطباعة غير متصلة — حلها في 3 خطوات</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Cashier مش قادر يتصل بخدمة الطباعة على الكمبيوتر ده. جرّب فحص الاتصال بإذن منك؛ من المتصفح لوحده
            ما نقدرش نحدد هل مهمة Windows مش موجودة ولا موجودة ومتوقفة؛ أداة التثبيت بتفحص ده على جهازك.
          </p>
        </div>
      </div>

      <fieldset className="mt-4 space-y-2">
        <legend className="mb-2 text-xs font-semibold">الطابعة متوصلة بأي جهاز؟</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => setPrinterLocation('this-device')}
            aria-pressed={printerLocation === 'this-device'}
            data-testid="printer-location-local"
            className={`flex items-center gap-2 rounded-xl border p-3 text-right text-xs font-semibold
              ${printerLocation === 'this-device' ? 'border-foreground bg-background' : 'border-border/70 hover:bg-background/60'}`}>
            <Printer className="size-4 shrink-0" aria-hidden/> الطابعة على الجهاز ده
          </button>
          <button type="button" onClick={() => setPrinterLocation('another-device')}
            aria-pressed={printerLocation === 'another-device'}
            data-testid="printer-location-remote"
            className={`flex items-center gap-2 rounded-xl border p-3 text-right text-xs font-semibold
              ${printerLocation === 'another-device' ? 'border-foreground bg-background' : 'border-border/70 hover:bg-background/60'}`}>
            <Monitor className="size-4 shrink-0" aria-hidden/> الطابعة على جهاز تاني
          </button>
        </div>
      </fieldset>

      {printerLocation === 'this-device' ? (
        <>
          <ol className="mt-4 space-y-3">
            <li className="flex items-start gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-bold">1</span>
              <div>
                اتأكد إن طابعة <strong>XP-80</strong> متوصلة ومثبتة على Windows.
                <p className="mt-1 text-xs text-muted-foreground">
                  لو أول مرة تستخدم الجهاز ده، ثبّت Node.js 22 أو أحدث أيضًا.{' '}
                  <a href="https://nodejs.org/en/download" target="_blank" rel="noopener noreferrer"
                    className="font-semibold underline underline-offset-2">تحميل Node.js الرسمي</a>
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-bold">2</span>
              <div className="min-w-0 flex-1">
                <strong>نزّل أداة CUT Print Agent</strong>، وبعد التنزيل اضغط كليك يمين على الملف
                واختر <strong>Run with PowerShell</strong> على الكمبيوتر الحالي.
                <p className="mt-1 text-xs text-muted-foreground">
                  الأداة هتفحص مهمة {TASK_NAME} في Task Scheduler. لو موجودة بتحاول تشغّلها، ولو مش موجودة بتثبتها وتشغّلها. لو الإصدار قديم بتعمل تحديث مع نسخة احتياطية واسترجاع عند الفشل.
                  مش هتطبع أي ورق أثناء التثبيت.
                </p>
                <a href={INSTALLER_URL} download="Install-CUT-Print-Agent.ps1"
                  data-testid="print-agent-download"
                  className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-bold text-background hover:opacity-90">
                  <Download className="size-4" aria-hidden/> تنزيل أداة التثبيت لـWindows
                </a>
              </div>
            </li>
            <li className="flex items-start gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-bold">3</span>
              <div>
                ارجع لـCashier واضغط <strong>فحص الاتصال</strong>. الفحص ده <strong>مش هيطبع ورق</strong>.
              </div>
            </li>
          </ol>
          {!compact && (
            <div className="mt-3 text-xs text-muted-foreground">
              لو المهمة موجودة بالفعل، ممكن تشغّلها من Task Scheduler ثم Run، من غير ما تنزّل أي حاجة.
              <button type="button" onClick={() => void copyStartCommand()}
                className="mr-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                <ClipboardCopy className="size-3.5" aria-hidden/>
                {copied ? 'تم نسخ الأمر' : 'أو انسخ أمر التشغيل في PowerShell'}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-border bg-background/70 p-4 text-sm">
          <p className="font-bold">مش محتاج تثبّت Agent على كل الأجهزة.</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            ثبّت CUT Print Agent على جهاز Windows اللي متوصل بالطابعة فقط.
            حاليًا طباعة Cashier المباشرة بتستخدم الطابعة المحلية؛ الطباعة من جهاز على طابعة جهاز آخر
            محتاجة ميزة Shared Printer / Central Print Queue، ولسه مش مفعّلة.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            لحد تفعيل مشاركة الطابعات، افتح Cashier على الكمبيوتر المتوصل بالطابعة لطباعة الفاتورة.
            ما تفتحش منفذ 7788 على شبكة المحل أو الإنترنت.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {printerLocation === 'this-device' && (<>
        <Button type="button" size="sm" onClick={() => void checkConnection()}
          disabled={checkState === 'checking'} data-testid="local-print-check">
          {checkState === 'checking'
            ? <Loader2 className="size-4 animate-spin" aria-hidden/>
            : <RefreshCw className="size-4" aria-hidden/>}
          {checkState === 'checking' ? 'بنفحص الاتصال...' : 'فحص الاتصال'}
        </Button>
        <a href={`${PRINT_SERVICE_URL}/health`} target="_blank" rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-muted">
          <ExternalLink className="size-3.5" aria-hidden/> فتح رابط فحص الخدمة
        </a>
        </>)}
        <Link href="/admin/settings/printing"
          className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-muted">
          إعدادات الطباعة
        </Link>
      </div>

      {printerLocation === 'this-device' && checkState === 'connected' && (
        <div role="status" data-testid="local-print-connected"
          className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-600/25 bg-emerald-500/10 p-3 text-xs">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden/>
          <span>الخدمة بتستجيب على الجهاز الحالي. الاتصال فقط اتأكد، مش خروج ورقة فعلية؛ اطبع اختبارًا واحدًا من زر الطباعة المعتاد.</span>
        </div>
      )}
      {printerLocation === 'this-device' && checkState === 'outdated' && (
        <div role="alert" className="mt-3 rounded-lg border border-amber-500/30 bg-background/60 p-3 text-xs">
          نسخة Print Agent قديمة. نزّل أداة V2 وشغّلها لتحديث النسخة مع الحفاظ على الإعدادات، ثم أعد فحص الاتصال.
        </div>
      )}
      {printerLocation === 'this-device' && checkState === 'disconnected' && (
        <div role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-background/60 p-3 text-xs">
          <TriangleAlert className="size-4 shrink-0 text-amber-600" aria-hidden/>
          <span>الخدمة لسه مش متصلة على الجهاز الحالي. شغّل أداة التثبيت أو افتح رابط فحص الخدمة.</span>
        </div>
      )}

      <div className="mt-3 border-t border-border/60 pt-3">
        <button type="button" onClick={() => setExpanded((x) => !x)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1.5 text-xs font-semibold underline underline-offset-2">
          <CircleHelp className="size-3.5" aria-hidden/> لو الخطوات مش نفعت
        </button>
        {expanded && (
          <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
            <p>لو البرنامج طلب تعريف XP-80 أو Node.js، ثبّتهم على الجهاز الحالي أولًا ثم شغّل الملف مرة تانية.</p>
            <p>لو مهمة Windows متثبتة لكنها مش بتشتغل، افتح Task Scheduler وابحث عن <strong>{TASK_NAME}</strong>، واضغط Run.</p>
            <code dir="ltr" className="block max-w-full overflow-x-auto rounded-lg bg-muted p-2 text-[11px] text-foreground">{START_COMMAND}</code>
            <p>لو رابط الفحص بيظهر <code>"status":"ok"</code> لكن الموقع مش بيتصل، اسمح لموقع Cashier بصلاحية Loopback network من إعدادات Chrome، وراجع إعدادات <code>ALLOWED_ORIGINS</code> مع مسؤول النظام.</p>
            {errorCode === 'CORS_BLOCKED' && <p>خطأ CORS: لازم مصدر الموقع الرسمي يكون ضمن إعدادات Agent المسموحة.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
