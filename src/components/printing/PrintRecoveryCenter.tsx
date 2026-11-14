'use client';

import { AlertCircle, CheckCircle2, Download, ExternalLink, RefreshCcw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildPrintRecoveryPlan, type RecoveryContext } from '@/lib/printRecoveryPlan';
import { PRINT_SERVICE_URL } from '@/lib/localPrintClient';

type Props = RecoveryContext & {
  busy: boolean;
  onCheck: () => void;
  onEnable: () => void;
  onEnableTest: () => void;
  onTest: () => void;
};

const CHECKER = '/downloads/Check-CUT-Print-Agent.ps1';
const REPAIR = '/downloads/Install-CUT-Print-Agent.ps1';

/**
 * Guided recovery only: network checks are read-only.
 * The browser cannot install apps, restart Windows tasks or verify physical paper.
 */
export default function PrintRecoveryCenter(props: Props) {
  const step = buildPrintRecoveryPlan(props)[0];
  const ok = step.kind === 'ready';
  return (
    <section dir="rtl" data-testid="print-recovery-center" className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <ShieldAlert className="h-5 w-5 text-amber-600" />}
        <h2 className="text-base font-bold">مركز إصلاح الطباعة</h2>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        تشخيص متدرّج، خطوة واحدة مناسبة للحالة الحالية. الفحص مش بيطبع، ومفيش إعادة طباعة تلقائية.
      </p>
      <div className="mt-4 rounded-xl border border-border bg-muted/20 p-4">
        <p className="text-xs text-muted-foreground">المستوى {step.level} من 5</p>
        <h3 className="mt-1 text-sm font-bold">{step.title}</h3>
        <p className="mt-2 text-sm leading-relaxed">{step.detail}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(step.action === 'check' || step.action === 'permissions') && (
            <Button onClick={props.onCheck} disabled={props.busy}>
              <RefreshCcw className="h-4 w-4" /> فحص الاتصال
            </Button>
          )}
          {step.action === 'enable' && (
            <Button onClick={props.onEnable} disabled={props.busy}>تفعيل الطباعة</Button>
          )}
          {step.action === 'test' && props.settings?.types.other === false && (
            <Button onClick={props.onEnableTest} disabled={props.busy}>تفعيل إيصالات الاختبار</Button>
          )}
          {step.action === 'test' && props.settings?.types.other !== false && (
            <Button onClick={props.onTest} disabled={props.busy}>إرسال ورقة اختبار واحدة</Button>
          )}
          {step.action === 'local-check' && (
            <a href={CHECKER} download="Check-CUT-Print-Agent.ps1"
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-semibold text-background">
              <Download className="h-4 w-4" /> تنزيل فحص وإصلاح التشغيل
            </a>
          )}
          {step.action === 'upgrade' && (
            <a href={REPAIR} download="Install-CUT-Print-Agent.ps1"
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-semibold text-background">
              <Download className="h-4 w-4" /> تنزيل تحديث وإصلاح Agent
            </a>
          )}
          {step.action === 'open-printers' && (
            <span className="text-xs text-muted-foreground">
              على الكمبيوتر: Settings → Bluetooth & devices → Printers & scanners
            </span>
          )}
          {(step.action === 'local-check' || step.action === 'upgrade') && (
            <p className="w-full text-xs text-muted-foreground">
              الملف بيتشغّل محليًا على كمبيوتر الكاشير بـ Run with PowerShell. المتصفح ما يقدرش يشغّله بنفسه.
            </p>
          )}
          {(step.kind === 'agent' || step.kind === 'settings') && (
            <a href={PRINT_SERVICE_URL + '/health'} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs underline underline-offset-2">
              <ExternalLink className="h-3 w-3" /> فحص الخدمة المباشر
            </a>
          )}
        </div>
      </div>
      {step.kind === 'queue' && (
        <p className="mt-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          ما تمسحش قائمة الانتظار أو تضغط طباعة مرة تانية قبل ما تتأكد إن الورقة ما خرجتش.
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        لو المشكلة مستمرة، الفاتورة المسجلة تفضل في Casher وتقدر تعرضها من سجل الفواتير. إعادة الطباعة لازم تكون قرار يدوي بعد التأكد من حالة الورق.
      </p>
    </section>
  );
}
