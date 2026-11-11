'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleHelp, ClipboardCopy, ExternalLink, Loader2, Printer, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  PRINT_SERVICE_URL, checkLocalPrintServiceHealth, type PrintErrorCode,
} from '@/lib/localPrintClient';

export function isLocalAgentConnectionError(code: PrintErrorCode | null | undefined): boolean {
  return code === 'SERVICE_UNAVAILABLE' || code === 'NETWORK_ERROR'
    || code === 'CORS_BLOCKED' || code === 'TIMEOUT';
}

type Props = {
  /** A failed print never gets retried automatically: only GET /health is called. */
  onReconnect?: () => void | Promise<void>;
  errorCode?: PrintErrorCode | null;
  compact?: boolean;
};

type CheckState = 'idle' | 'checking' | 'connected' | 'disconnected';

const TASK_NAME = 'CUT Salon Print Agent';
const START_COMMAND = "Start-ScheduledTask -TaskName 'CUT Salon Print Agent'";

export default function LocalPrintConnectionHelp({ onReconnect, errorCode, compact = false }: Props) {
  const [checkState, setCheckState] = useState<CheckState>('idle');
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function checkConnection() {
    if (checkState === 'checking') return;
    setCheckState('checking');
    // This is a health check, NOT a print or spool request.
    const alive = await checkLocalPrintServiceHealth(2200);
    setCheckState(alive ? 'connected' : 'disconnected');
    if (alive && onReconnect) {
      try { await onReconnect(); }
      catch { /* Health was confirmed; settings/print errors still need separate handling. */ }
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
    <section data-testid="local-print-help" dir="rtl" role="region" aria-label="إصلاح اتصال خدمة الطباعة المحلية"
      className="rounded-2xl border border-amber-500/35 bg-amber-500/5 p-4 text-foreground sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
          <Printer className="h-5 w-5" aria-hidden/>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold sm:text-base">خدمة الطباعة غير متصلة — حلها في 3 خطوات</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            المشكلة في اتصال المتصفح بـ CUT Print Agent على هذا الكمبيوتر، ومش معناها بالضرورة إن طابعة XP-80 معطلة.
          </p>
        </div>
      </div>

      <ol className="mt-4 space-y-3">
        <li className="flex items-start gap-3 text-sm">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-bold">1</span>
          <div>افتح Cashier من <strong>نفس كمبيوتر الكاشير</strong> المتوصل بالطابعة.</div>
        </li>
        <li className="flex items-start gap-3 text-sm">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-bold">2</span>
          <div className="min-w-0 flex-1">
            افتح <strong>Task Scheduler</strong> من Start في Windows، واختار
            <strong dir="ltr" className="mx-1 inline-block">{TASK_NAME}</strong>
            ثم اضغط <strong>Run</strong>.
            {!compact && (
              <div className="mt-2">
                <button type="button" onClick={() => void copyStartCommand()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted">
                  <ClipboardCopy className="size-3.5" aria-hidden/>
                  {copied ? 'اتنسخ أمر التشغيل' : 'أو انسخ أمر التشغيل في PowerShell'}
                </button>
              </div>
            )}
          </div>
        </li>
        <li className="flex items-start gap-3 text-sm">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-bold">3</span>
          <div>اضغط <strong>فحص الاتصال</strong> تحت. الفحص ده <strong>مش هيطبع ورق</strong>.</div>
        </li>
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => void checkConnection()} disabled={checkState === 'checking'}
          data-testid="local-print-check">
          {checkState === 'checking' ? <Loader2 className="size-4 animate-spin" aria-hidden/> : <RefreshCw className="size-4" aria-hidden/>}
          {checkState === 'checking' ? 'بنفحص الاتصال...' : 'فحص الاتصال'}
        </Button>
        <a href={`${PRINT_SERVICE_URL}/health`} target="_blank" rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-muted">
          <ExternalLink className="size-3.5" aria-hidden/>
          فتح رابط فحص الخدمة
        </a>
        <Link href="/admin/settings/printing"
          className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-muted">
          إعدادات الطباعة
        </Link>
      </div>

      {checkState === 'connected' && (
        <div role="status" data-testid="local-print-connected"
          className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-600/25 bg-emerald-500/10 p-3 text-xs">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden/>
          <span>الخدمة بقت بتستجيب. ده تأكيد اتصال فقط، مش تأكيد إن الورقة اتطبعت؛ جرّب طباعة واحدة من الزر المعتاد.</span>
        </div>
      )}
      {checkState === 'disconnected' && (
        <div role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-background/60 p-3 text-xs">
          <TriangleAlert className="size-4 shrink-0 text-amber-600" aria-hidden/>
          <span>لسه مش متصلين. تأكد إن مهمة Windows شغالة، أو استخدم رابط فحص الخدمة للتشخيص.</span>
        </div>
      )}

      <div className="mt-3 border-t border-border/60 pt-3">
        <button type="button" onClick={() => setExpanded((state) => !state)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground underline underline-offset-2">
          <CircleHelp className="size-3.5" aria-hidden/>
          لو الخطوات مش نفعت
        </button>
        {expanded && (
          <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
            <p>لو المهمة مش موجودة، لازم CUT Print Agent يتثبت على نفس جهاز الكاشير من مسؤول النظام؛ الموقع ما يقدرش يشغّل برنامج Windows لوحده.</p>
            <p>لو رابط الفحص بيفتح وبيظهر <code className="rounded bg-muted px-1">"status":"ok"</code> لكن Cashier مش بيتصل، اسمح لموقع Cashier بالوصول للشبكة المحلية من إعدادات Chrome (Local network access)، وافتح الموقع تاني.</p>
            <p>لو استخدمت زر نسخ الأمر، افتح PowerShell في Windows والصقه هناك:</p>
            <code dir="ltr" className="block max-w-full overflow-x-auto rounded-lg bg-muted p-2 text-[11px] text-foreground">{START_COMMAND}</code>
            {errorCode === 'CORS_BLOCKED' && (
              <p>ولو المتصفح بيعرض خطأ CORS، المسؤول يراجع <code>ALLOWED_ORIGINS</code> في إعدادات الـAgent بحيث يشمل رابط Cashier.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
