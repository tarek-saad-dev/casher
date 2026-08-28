'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  MessageCircle,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import AdminWhatsAppTemplatesPanel from '@/components/admin/whatsapp/AdminWhatsAppTemplatesPanel';
import AdminWhatsAppCampaignsPanel from '@/components/admin/whatsapp/AdminWhatsAppCampaignsPanel';
import AdminWhatsAppGroupsPanel from '@/components/admin/whatsapp/AdminWhatsAppGroupsPanel';
import { useSession } from '@/hooks/useSession';

type StatusPayload = {
  integrationEnabled?: boolean;
  botHealth?: { ok: boolean; reason?: string; httpStatus?: number };
  status?: {
    available?: boolean;
    connected?: boolean;
    chromeConnected?: boolean;
    whatsappReady?: boolean;
    whatsappTabFound?: boolean;
    reason?: string;
  };
};

type Toast = { id: number; type: 'success' | 'error'; message: string };
type Tab = 'templates' | 'campaigns' | 'groups';

function jsonHeaders(res: Response): boolean {
  return (res.headers.get('content-type') || '').includes('application/json');
}

export default function AdminWhatsAppPage() {
  const session = useSession();
  const branchId = session.viewBranch?.branchId ?? session.activeBranch?.branchId ?? null;

  const [tab, setTab] = useState<Tab>('templates');
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch('/api/admin/whatsapp/status');
      if (!res.ok) {
        setStatus(null);
        setStatusUnavailable(true);
        return;
      }
      const data = jsonHeaders(res) ? ((await res.json()) as StatusPayload) : null;
      setStatus(data);
      setStatusUnavailable(false);
    } catch {
      setStatus(null);
      setStatusUnavailable(true);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const gatewayAvailable = status?.status?.available === true;
  const whatsappReady = status?.status?.whatsappReady === true;
  const chromeConnected = status?.status?.chromeConnected === true;
  const whatsappTabFound = status?.status?.whatsappTabFound === true;
  const serviceOk = status?.botHealth?.ok === true;
  const fullyConnected =
    status?.status?.connected === true ||
    (gatewayAvailable &&
      chromeConnected &&
      whatsappReady &&
      whatsappTabFound);

  const statusHeadline = statusUnavailable
    ? 'حالة واتساب غير متاحة حالياً'
    : fullyConnected
      ? 'واتساب متصل وجاهز'
      : serviceOk || gatewayAvailable
        ? 'الخدمة تعمل ولكن واتساب غير جاهز'
        : 'حالة واتساب غير متاحة حالياً';

  return (
    <div className="max-w-7xl mx-auto" dir="rtl">
      <PageHeader
        title="واتساب"
        description="إدارة اتصال واتساب ورسائل النظام والحملات"
      />

      <section className="rounded-2xl border border-border bg-surface p-5 mb-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">حالة الاتصال</h2>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void loadStatus()}
            disabled={statusLoading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${statusLoading ? 'animate-spin' : ''}`} />
            تحديث الحالة
          </Button>
        </div>

        {statusLoading && !status && !statusUnavailable ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : statusUnavailable ? (
          <p className="text-sm text-zinc-400">
            حالة واتساب غير متاحة حالياً. يمكنك متابعة إدارة الرسائل بشكل طبيعي.
          </p>
        ) : (
          <div className="space-y-3">
            <p
              className={`text-sm font-medium ${
                fullyConnected
                  ? 'text-emerald-300'
                  : serviceOk || gatewayAvailable
                    ? 'text-amber-300'
                    : 'text-zinc-400'
              }`}
            >
              {statusHeadline}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatusTile
                ok={serviceOk}
                label={serviceOk ? 'الخدمة متاحة' : 'الخدمة غير متاحة'}
                hint="حالة الخدمة"
              />
              <StatusTile
                ok={chromeConnected}
                label={chromeConnected ? 'Chrome متصل' : 'Chrome غير متصل'}
                hint="Chrome Connected"
              />
              <StatusTile
                ok={whatsappReady}
                label={whatsappReady ? 'جاهز' : 'غير جاهز'}
                hint="WhatsApp Ready"
              />
              <StatusTile
                ok={whatsappTabFound}
                label={whatsappTabFound ? 'تاب واتساب موجود' : 'تاب واتساب غير موجود'}
                hint="WhatsApp Tab"
              />
            </div>
          </div>
        )}
      </section>

      <div className="mb-6 flex gap-2 border-b border-border pb-1">
        <button
          type="button"
          onClick={() => setTab('templates')}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'templates'
              ? 'bg-primary/15 text-primary border-b-2 border-primary'
              : 'text-zinc-400 hover:text-foreground'
          }`}
        >
          القوالب
        </button>
        <button
          type="button"
          onClick={() => setTab('campaigns')}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'campaigns'
              ? 'bg-primary/15 text-primary border-b-2 border-primary'
              : 'text-zinc-400 hover:text-foreground'
          }`}
        >
          الحملات
        </button>
        <button
          type="button"
          onClick={() => setTab('groups')}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'groups'
              ? 'bg-primary/15 text-primary border-b-2 border-primary'
              : 'text-zinc-400 hover:text-foreground'
          }`}
        >
          الجروبات
        </button>
      </div>

      {tab === 'templates' ? (
        <AdminWhatsAppTemplatesPanel branchId={branchId} onToast={addToast} />
      ) : tab === 'campaigns' ? (
        <AdminWhatsAppCampaignsPanel branchId={branchId} onToast={addToast} />
      ) : (
        <AdminWhatsAppGroupsPanel onToast={addToast} />
      )}

      <div className="fixed bottom-4 left-4 z-[100] flex max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300'
                : 'bg-rose-950/90 border-rose-500/40 text-rose-300'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusTile({
  ok,
  label,
  hint,
}: {
  ok: boolean;
  label: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/40 px-3 py-3">
      <p className="text-xs text-zinc-400">{hint}</p>
      <div className="mt-1.5 flex items-center gap-2">
        {ok ? (
          <Wifi className="h-4 w-4 text-emerald-400" />
        ) : (
          <WifiOff className="h-4 w-4 text-zinc-500" />
        )}
        <span className={ok ? 'text-sm font-medium text-emerald-300' : 'text-sm text-zinc-300'}>
          {label}
        </span>
      </div>
    </div>
  );
}
