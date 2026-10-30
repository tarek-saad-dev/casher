
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, CheckCircle2, ChevronLeft, Clock3, Monitor, Printer,
  RefreshCw, Scissors, ShieldCheck, TestTube2, Wifi, WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  getLocalPrinterSettings, patchLocalPrinterSettings, printLocalTestReceipt,
  type LocalPrinterSettings, type ReceiptType,
} from '@/lib/localPrintClient';

const RECEIPTS: Array<{ key: ReceiptType; title: string; subtitle: string }> = [
  { key: 'invoice', title: 'فواتير المبيعات', subtitle: 'طباعة فواتير نقاط البيع' },
  { key: 'expense', title: 'إيصالات المصروفات', subtitle: 'طباعة إيصالات تسجيل المصروفات' },
  { key: 'deduction', title: 'إيصالات الخصومات والسلف', subtitle: 'الإيصالات المرسلة من شاشة الخصومات' },
  { key: 'other', title: 'إيصالات أخرى واختبار الطابعة', subtitle: 'أي نوع طباعة جديد غير مصنف حتى الآن' },
];

function SettingRow({
  label, detail, checked, disabled, onChange,
}: { label: string; detail: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-4 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{label}</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}

export default function PrinterControlPage() {
  const [settings, setSettings] = useState<LocalPrinterSettings | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busyRef = useRef(false);

  const refresh = useCallback(async (quiet = false) => {
    if (busyRef.current) return;
    if (!quiet) setLoading(true);
    try {
      const data = await getLocalPrinterSettings();
      setSettings(data);
      setConnected(true);
      if (!quiet) setError(null);
    } catch {
      setConnected(false);
      setSettings(null);
      if (!quiet) setError('تعذر الاتصال بخدمة الطباعة على الكمبيوتر الحالي. تأكد أن CUT Salon Print Agent يعمل.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(true), 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  const change = async (patch: { enabled?: boolean; autoCut?: boolean; types?: Partial<LocalPrinterSettings['types']> }) => {
    if (busyRef.current || !settings) return;
    busyRef.current = true;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      await patchLocalPrinterSettings(patch);
      const updated = await getLocalPrinterSettings();
      setSettings(updated);
      setNotice('تم حفظ الإعداد على هذا الكمبيوتر.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر حفظ الإعداد. حاول مرة أخرى.');
    } finally {
      setSaving(false);
      busyRef.current = false;
    }
  };

  const test = async () => {
    if (busyRef.current || !settings || !settings.enabled || !settings.types.other) return;
    busyRef.current = true;
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      await printLocalTestReceipt();
      setNotice('تم إرسال ورقة الاختبار إلى Windows. تأكد بنفسك من خروج الورقة ووضوحها.');
      const updated = await getLocalPrinterSettings();
      setSettings(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إرسال ورقة الاختبار.');
    } finally {
      setTesting(false);
      busyRef.current = false;
    }
  };

  const inactive = !connected || loading || saving || testing;
  const running = connected && settings?.enabled;
  const statusLabel = !connected ? 'الخدمة غير متصلة' : running ? 'الطباعة مفعّلة' : 'الطباعة متوقفة';

  return (
    <div dir="rtl" className="mx-auto w-full max-w-5xl space-y-6 px-2 pb-12 pt-2 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/settings" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            الإعدادات <ChevronLeft className="h-3 w-3" /> الطباعة
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">إدارة الطباعة</h1>
          <p className="mt-1 text-sm text-muted-foreground">تحكم بسيط في طباعة إيصالات CUT من الكمبيوتر الحالي.</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading || saving || testing}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث الحالة
        </Button>
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${running ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
              {connected ? <Printer className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
            </span>
            <div>
              <p className="text-xs text-muted-foreground">حالة الطباعة على الجهاز</p>
              <h2 className="mt-1 text-lg font-bold text-foreground">{statusLabel}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {connected ? `${settings?.printer} · ${settings?.engine?.toUpperCase()} · خدمة محلية` : 'لا يمكن التحكم في جهاز غير متصل'}
              </p>
            </div>
          </div>
          <Switch
            aria-label="تشغيل أو إيقاف كل الطباعة"
            checked={Boolean(settings?.enabled)}
            disabled={inactive}
            onCheckedChange={v => void change({ enabled: v })}
          />
        </div>
        <p className="mt-4 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          المفتاح يوقف إرسال مهام طباعة جديدة؛ لا يوقف خدمة Windows ولا يلغي المهام التي وصلت للطابعة بالفعل.
        </p>
      </section>

      {!connected && !loading && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>خدمة الطباعة غير متاحة على هذا الكمبيوتر. افتح الصفحة من جهاز الكاشير الذي يشغّل CUT Salon Print Agent، وتأكد من تشغيل خدمة Windows.</span>
        </div>
      )}
      {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
      {notice && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-500" />{notice}</div>}

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6 lg:col-span-3">
          <h2 className="text-base font-bold text-foreground">الإيصالات المسموح بطباعتها</h2>
          <p className="mt-1 text-xs text-muted-foreground">اقفل أي نوع مش عايزه يطلع من الطابعة، بدون التأثير على تسجيل المبيعات أو المصروفات.</p>
          <div className="mt-3">
            {RECEIPTS.map(receipt => (
              <SettingRow
                key={receipt.key}
                label={receipt.title}
                detail={receipt.subtitle}
                checked={Boolean(settings?.types?.[receipt.key])}
                disabled={inactive}
                onChange={v => void change({ types: { [receipt.key]: v } })}
              />
            ))}
          </div>
        </section>

        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Scissors className="h-4 w-4 text-primary" />
              <h2 className="text-base font-bold text-foreground">إعدادات الورق</h2>
            </div>
            <div className="mt-3">
              <SettingRow
                label="القص التلقائي"
                detail="قص الريسيت بعد انتهاء الطباعة (ESC/POS)"
                checked={Boolean(settings?.autoCut)}
                disabled={inactive || settings?.engine !== 'escpos'}
                onChange={v => void change({ autoCut: v })}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">تغيير اسم الطابعة أو محركها بيحتاج إعداد على Windows، ومش بنغيره من الصفحة حاليًا لتجنب تعطيل الشغل.</p>
          </section>
          <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <TestTube2 className="h-4 w-4 text-primary" />
              <h2 className="text-base font-bold text-foreground">اختبار الطابعة</h2>
            </div>
            <p className="mb-4 mt-2 text-xs leading-relaxed text-muted-foreground">اطبع ورقة اختبار قصيرة واحدة، وتأكد بنفسك من وضوح الكتابة والقطع.</p>
            <Button onClick={() => void test()} disabled={inactive || !running || !settings?.types.other} className="w-full">
              <Printer className="h-4 w-4" />
              {testing ? 'جاري إرسال الاختبار...' : 'طباعة ورقة اختبار'}
            </Button>
          </section>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-base font-bold text-foreground">تشخيص سريع</h2>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Monitor className="h-4 w-4" /> مكان التحكم</div>
            <p className="mt-2 font-semibold text-foreground">هذا الكمبيوتر فقط</p>
          </div>
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-4 w-4" /> داخل خدمة الطباعة</div>
            <p className="mt-2 font-semibold text-foreground">{settings ? `${settings.pendingJobs} انتظار · ${settings.activeJobs} تنفيذ` : 'غير متاح'}</p>
          </div>
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Wifi className="h-4 w-4" /> آخر مهمة قبلها Windows</div>
            <p className="mt-2 font-semibold text-foreground">{settings?.lastAcceptedAt ? new Date(settings.lastAcceptedAt).toLocaleString('ar-EG') : 'غير متوفر'}</p>
          </div>
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          الاتصال بالخدمة لا يضمن أن الورق خرج فعليًا. حالة الطابعة الميكانيكية وقائمة مهام Windows تحتاج فحص من الجهاز.
        </p>
      </section>
    </div>
  );
}
