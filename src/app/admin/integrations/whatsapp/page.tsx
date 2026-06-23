'use client';

import { useState } from 'react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { MessageCircle, RefreshCw, Send, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface StatusData {
  integrationEnabled: boolean;
  apiBaseUrl: string;
  saleEnabled: boolean;
  bookingEnabled: boolean;
  firstTimeEnabled: boolean;
  status: {
    available: boolean;
    chromeConnected?: boolean;
    whatsappReady?: boolean;
    whatsappTabFound?: boolean;
    reason?: string;
  };
}

interface TestResult {
  sent?: boolean;
  skipped?: boolean;
  status?: string;
  reason?: string;
  error?: string;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle className="w-4 h-4 text-green-500" />
      ) : (
        <XCircle className="w-4 h-4 text-red-400" />
      )}
      <span className={ok ? 'text-green-600 font-medium' : 'text-red-500'}>{label}</span>
    </div>
  );
}

export default function WhatsAppDiagnosticsPage() {
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastCheck, setLastCheck] = useState<string | null>(null);

  const [testType, setTestType] = useState<'sale' | 'booking' | 'first_time'>('sale');
  const [testPhone, setTestPhone] = useState('');
  const [testName, setTestName] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  async function handleCheckStatus() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/whatsapp/status');
      const data = await res.json() as StatusData;
      setStatusData(data);
      setLastCheck(new Date().toLocaleTimeString('ar-EG'));
    } catch {
      setStatusData(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleTestSend() {
    if (!testPhone.trim() || !testName.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/whatsapp/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: testType, phone: testPhone.trim(), customerName: testName.trim() }),
      });
      const data = await res.json() as { result: TestResult };
      setTestResult(data.result ?? data);
    } catch (err) {
      setTestResult({ error: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setTestLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8" dir="rtl">
      <PageHeader
        title="تشخيص تكامل واتساب"
        description="أداة تطوير فقط — لا تظهر في الإنتاج"
      >
        <MessageCircle className="w-5 h-5 text-green-600" />
      </PageHeader>

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 flex gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          هذه الصفحة متاحة في وضع التطوير فقط. إرسال رسالة اختبارية سيُنفِّذ إرسالاً حقيقياً عبر واتساب.
        </span>
      </div>

      {/* Connection status */}
      <section className="rounded-lg border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">حالة الاتصال</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCheckStatus}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'جاري الفحص…' : 'فحص الاتصال'}
          </Button>
        </div>

        {statusData ? (
          <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <div className="text-muted-foreground">التكامل مفعّل</div>
            <StatusBadge ok={statusData.integrationEnabled} label={statusData.integrationEnabled ? 'نعم' : 'لا'} />

            <div className="text-muted-foreground">عنوان API</div>
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{statusData.apiBaseUrl}</code>

            <div className="text-muted-foreground">Chrome متصل</div>
            <StatusBadge ok={statusData.status.chromeConnected === true} label={statusData.status.chromeConnected === true ? 'نعم' : 'لا'} />

            <div className="text-muted-foreground">واتساب جاهز</div>
            <StatusBadge ok={statusData.status.whatsappReady === true} label={statusData.status.whatsappReady === true ? 'نعم' : 'لا'} />

            <div className="text-muted-foreground">تبويب واتساب موجود</div>
            <StatusBadge ok={statusData.status.whatsappTabFound === true} label={statusData.status.whatsappTabFound === true ? 'نعم' : 'لا'} />

            {!statusData.status.available && statusData.status.reason && (
              <>
                <div className="text-muted-foreground">السبب</div>
                <code className="text-xs text-red-500">{statusData.status.reason}</code>
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">اضغط على «فحص الاتصال» لعرض الحالة.</p>
        )}

        {lastCheck && (
          <p className="text-xs text-muted-foreground">آخر فحص: {lastCheck}</p>
        )}
      </section>

      {/* Manual test form */}
      <section className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="text-base font-semibold">اختبار يدوي</h2>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          تحذير: هذا إرسال حقيقي عبر واتساب وليس اختباراً وهمياً.
        </p>

        <div className="grid grid-cols-1 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">نوع الرسالة</label>
            <select
              value={testType}
              onChange={(e) => setTestType(e.target.value as typeof testType)}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            >
              <option value="sale">فاتورة بيع</option>
              <option value="booking">تأكيد حجز</option>
              <option value="first_time">عميل جديد (أول زيارة)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">رقم الهاتف</label>
            <input
              type="text"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="01557994946"
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
              dir="ltr"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">اسم العميل</label>
            <input
              type="text"
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              placeholder="طارق"
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            />
          </div>
        </div>

        <Button
          onClick={handleTestSend}
          disabled={testLoading || !testPhone.trim() || !testName.trim()}
          className="gap-2 bg-green-600 hover:bg-green-700 text-white"
        >
          <Send className="w-4 h-4" />
          {testLoading ? 'جاري الإرسال…' : 'إرسال رسالة اختبار'}
        </Button>

        {testResult && (
          <div className={`rounded p-3 text-sm font-mono ${
            testResult.sent ? 'bg-green-50 border border-green-200 text-green-800' :
            testResult.error ? 'bg-red-50 border border-red-200 text-red-800' :
            'bg-gray-50 border border-gray-200 text-gray-700'
          }`}>
            <pre className="whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}
