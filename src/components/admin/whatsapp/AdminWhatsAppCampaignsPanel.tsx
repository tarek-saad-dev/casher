'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { readFetchErrorMessage } from '@/lib/readFetchErrorMessage';
import type { AdminWhatsAppTemplateView } from './AdminWhatsAppTemplatesPanel';

type CampaignStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed';

type CampaignRow = {
  id: number;
  name: string;
  status: CampaignStatus;
  messageMode: 'template' | 'custom';
  templateKey: string | null;
  customMessage: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type CampaignDetail = CampaignRow & {
  audience: AudienceCriteria;
  progress: {
    totalRecipients: number;
    sentCount: number;
    failedCount: number;
    pendingCount: number;
    queuedCount: number;
    cancelledCount: number;
    skippedCount: number;
  };
};

type AudienceCriteria = {
  mode: 'all' | 'rules' | 'segment';
  segmentType?: 'today' | 'this_week' | 'two_weeks' | 'one_month';
  branchId?: number;
  minAge?: number;
  maxAge?: number;
  notVisitedSinceDays?: number;
  rules?: Array<{
    city?: string;
    cameFrom?: string;
    maritalStatus?: string;
    minVisits?: number;
    minSpend?: number;
    lastVisitFrom?: string;
    lastVisitTo?: string;
  }>;
};

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'مسودة',
  queued: 'في الانتظار',
  running: 'جارية',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  failed: 'فشلت',
};

const STATUS_VARIANT: Record<CampaignStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  queued: 'outline',
  running: 'default',
  completed: 'default',
  cancelled: 'destructive',
  failed: 'destructive',
};

type Props = {
  branchId: number | null;
  onToast: (type: 'success' | 'error', message: string) => void;
};

type View = 'list' | 'create' | 'detail';

export default function AdminWhatsAppCampaignsPanel({ branchId, onToast }: Props) {
  const [view, setView] = useState<View>('list');
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [templates, setTemplates] = useState<AdminWhatsAppTemplateView[]>([]);

  const [name, setName] = useState('');
  const [audienceMode, setAudienceMode] = useState<AudienceCriteria['mode']>('all');
  const [segmentType, setSegmentType] = useState<AudienceCriteria['segmentType']>('today');
  const [ruleCity, setRuleCity] = useState('');
  const [ruleMinVisits, setRuleMinVisits] = useState('');
  const [ruleMinSpend, setRuleMinSpend] = useState('');
  const [ruleLastFrom, setRuleLastFrom] = useState('');
  const [ruleLastTo, setRuleLastTo] = useState('');
  const [notVisitedSinceDays, setNotVisitedSinceDays] = useState('');
  const [minAge, setMinAge] = useState('');
  const [maxAge, setMaxAge] = useState('');
  const [messageMode, setMessageMode] = useState<'template' | 'custom'>('template');
  const [templateKey, setTemplateKey] = useState('');
  const [customMessage, setCustomMessage] = useState('مرحباً {{customerName}}\n\n');
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [audiencePreviewLoading, setAudiencePreviewLoading] = useState(false);
  const [messagePreview, setMessagePreview] = useState<string | null>(null);
  const [messagePreviewLoading, setMessagePreviewLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [confirmStartOpen, setConfirmStartOpen] = useState(false);
  const [draftCampaignId, setDraftCampaignId] = useState<number | null>(null);

  const audienceCriteria = useMemo((): AudienceCriteria => {
    const criteria: AudienceCriteria = {
      mode: audienceMode,
      branchId: branchId ?? undefined,
    };
    if (audienceMode === 'segment') {
      criteria.segmentType = segmentType;
    }
    if (audienceMode === 'rules') {
      criteria.rules = [
        {
          city: ruleCity || undefined,
          minVisits: ruleMinVisits ? Number(ruleMinVisits) : undefined,
          minSpend: ruleMinSpend ? Number(ruleMinSpend) : undefined,
          lastVisitFrom: ruleLastFrom || undefined,
          lastVisitTo: ruleLastTo || undefined,
        },
      ];
    }
    if (notVisitedSinceDays) criteria.notVisitedSinceDays = Number(notVisitedSinceDays);
    if (minAge) criteria.minAge = Number(minAge);
    if (maxAge) criteria.maxAge = Number(maxAge);
    return criteria;
  }, [
    audienceMode,
    branchId,
    segmentType,
    ruleCity,
    ruleMinVisits,
    ruleMinSpend,
    ruleLastFrom,
    ruleLastTo,
    notVisitedSinceDays,
    minAge,
    maxAge,
  ]);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/whatsapp/campaigns');
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر تحميل الحملات'));
      }
      const data = (await res.json()) as { campaigns?: CampaignRow[] };
      setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل الحملات');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/whatsapp/templates');
      if (!res.ok) return;
      const data = (await res.json()) as { templates?: AdminWhatsAppTemplateView[] };
      const list = Array.isArray(data.templates) ? data.templates : [];
      setTemplates(list);
      if (!templateKey && list[0]) setTemplateKey(list[0].templateKey);
    } catch {
      /* optional for create form */
    }
  }, [templateKey]);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/whatsapp/campaigns/${id}`);
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر تحميل تفاصيل الحملة'));
      }
      const data = (await res.json()) as { campaign?: CampaignDetail };
      setDetail(data.campaign ?? null);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذر تحميل تفاصيل الحملة');
    } finally {
      setDetailLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    if (view === 'list') void loadCampaigns();
  }, [view, loadCampaigns]);

  useEffect(() => {
    if (view === 'create') void loadTemplates();
  }, [view, loadTemplates]);

  useEffect(() => {
    if (view === 'detail' && selectedId != null) void loadDetail(selectedId);
  }, [view, selectedId, loadDetail]);

  const previewAudienceCount = async () => {
    setAudiencePreviewLoading(true);
    setAudienceCount(null);
    try {
      const res = await fetch('/api/admin/whatsapp/campaigns/audience/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audienceCriteria),
      });
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر معاينة الجمهور'));
      }
      const data = (await res.json()) as { preview?: { count?: number } };
      setAudienceCount(data.preview?.count ?? 0);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذر معاينة الجمهور');
    } finally {
      setAudiencePreviewLoading(false);
    }
  };

  const previewMessage = async () => {
    setMessagePreviewLoading(true);
    setMessagePreview(null);
    try {
      const res = await fetch('/api/admin/whatsapp/campaigns/message/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageMode,
          templateKey: messageMode === 'template' ? templateKey : null,
          customMessage: messageMode === 'custom' ? customMessage : null,
          sampleName: 'عميل تجريبي',
        }),
      });
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر معاينة الرسالة'));
      }
      const data = (await res.json()) as { rendered?: string };
      setMessagePreview(data.rendered ?? null);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذر معاينة الرسالة');
    } finally {
      setMessagePreviewLoading(false);
    }
  };

  const saveDraft = async (): Promise<number | null> => {
    if (!name.trim()) {
      onToast('error', 'اسم الحملة مطلوب');
      return null;
    }
    setSaveLoading(true);
    try {
      const res = await fetch('/api/admin/whatsapp/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          messageMode,
          templateKey: messageMode === 'template' ? templateKey : null,
          customMessage: messageMode === 'custom' ? customMessage : null,
          audience: audienceCriteria,
          branchId,
        }),
      });
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر حفظ المسودة'));
      }
      const data = (await res.json()) as { campaign?: { id?: number } };
      const id = data.campaign?.id ?? null;
      setDraftCampaignId(id);
      onToast('success', 'تم حفظ مسودة الحملة');
      return id;
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذر حفظ المسودة');
      return null;
    } finally {
      setSaveLoading(false);
    }
  };

  const startCampaign = async (campaignId: number) => {
    setStartLoading(true);
    try {
      const res = await fetch(`/api/admin/whatsapp/campaigns/${campaignId}/start`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر بدء الحملة'));
      }
      onToast('success', 'تم بدء الحملة وإضافة الرسائل إلى قائمة الإرسال');
      setConfirmStartOpen(false);
      setView('list');
      setSelectedId(campaignId);
      setView('detail');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذر بدء الحملة');
    } finally {
      setStartLoading(false);
    }
  };

  const handleConfirmStart = async () => {
    let id = draftCampaignId;
    if (!id) {
      id = await saveDraft();
    }
    if (id) await startCampaign(id);
  };

  const cancelCampaign = async (campaignId: number) => {
    setCancelLoading(true);
    try {
      const res = await fetch(`/api/admin/whatsapp/campaigns/${campaignId}/cancel`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر إلغاء الحملة'));
      }
      onToast('success', 'تم إلغاء الحملة');
      await loadDetail(campaignId);
      await loadCampaigns();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذر إلغاء الحملة');
    } finally {
      setCancelLoading(false);
    }
  };

  const resetCreateForm = () => {
    setName('');
    setAudienceMode('all');
    setSegmentType('today');
    setRuleCity('');
    setRuleMinVisits('');
    setRuleMinSpend('');
    setRuleLastFrom('');
    setRuleLastTo('');
    setNotVisitedSinceDays('');
    setMinAge('');
    setMaxAge('');
    setMessageMode('template');
    setCustomMessage('مرحباً {{customerName}}\n\n');
    setAudienceCount(null);
    setMessagePreview(null);
    setDraftCampaignId(null);
  };

  if (view === 'create') {
    return (
      <section className="rounded-2xl border border-border bg-surface p-5 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setView('list'); resetCreateForm(); }}>
              <ArrowRight className="h-4 w-4" />
              رجوع
            </Button>
            <h2 className="text-base font-semibold">إنشاء حملة</h2>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">اسم الحملة</label>
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: عرض نهاية الأسبوع"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">الفرع</label>
            <input
              className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
              value={branchId != null ? `فرع #${branchId}` : '—'}
              readOnly
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">الجمهور</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {(['all', 'rules', 'segment'] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                size="sm"
                variant={audienceMode === mode ? 'default' : 'outline'}
                onClick={() => setAudienceMode(mode)}
              >
                {mode === 'all' ? 'الكل' : mode === 'rules' ? 'قواعد' : 'شريحة'}
              </Button>
            ))}
          </div>

          {audienceMode === 'segment' && (
            <select
              className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={segmentType}
              onChange={(e) => setSegmentType(e.target.value as AudienceCriteria['segmentType'])}
            >
              <option value="today">زيارة اليوم</option>
              <option value="this_week">هذا الأسبوع</option>
              <option value="two_weeks">آخر أسبوعين</option>
              <option value="one_month">آخر شهر</option>
            </select>
          )}

          {audienceMode === 'rules' && (
            <div className="grid gap-3 md:grid-cols-2 mb-4">
              <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="المدينة" value={ruleCity} onChange={(e) => setRuleCity(e.target.value)} />
              <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="الحد الأدنى للزيارات" value={ruleMinVisits} onChange={(e) => setRuleMinVisits(e.target.value)} />
              <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="الحد الأدنى للإنفاق" value={ruleMinSpend} onChange={(e) => setRuleMinSpend(e.target.value)} />
              <input type="date" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={ruleLastFrom} onChange={(e) => setRuleLastFrom(e.target.value)} />
              <input type="date" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={ruleLastTo} onChange={(e) => setRuleLastTo(e.target.value)} />
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3 mb-4">
            <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="لم يزر منذ (أيام)" value={notVisitedSinceDays} onChange={(e) => setNotVisitedSinceDays(e.target.value)} />
            <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="العمر من" value={minAge} onChange={(e) => setMinAge(e.target.value)} />
            <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="العمر إلى" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
          </div>

          <Button type="button" variant="outline" size="sm" onClick={() => void previewAudienceCount()} disabled={audiencePreviewLoading}>
            {audiencePreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'معاينة عدد المستلمين'}
          </Button>
          {audienceCount != null && (
            <p className="mt-2 text-sm text-emerald-300">عدد المستلمين المتوقع: {audienceCount}</p>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">الرسالة</p>
          <div className="flex flex-wrap gap-2 mb-3">
            <Button type="button" size="sm" variant={messageMode === 'template' ? 'default' : 'outline'} onClick={() => setMessageMode('template')}>قالب</Button>
            <Button type="button" size="sm" variant={messageMode === 'custom' ? 'default' : 'outline'} onClick={() => setMessageMode('custom')}>مخصص</Button>
          </div>
          {messageMode === 'template' ? (
            <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
              {templates.map((t) => (
                <option key={t.templateKey} value={t.templateKey}>{t.label}</option>
              ))}
            </select>
          ) : (
            <Textarea dir="rtl" className="min-h-[140px]" value={customMessage} onChange={(e) => setCustomMessage(e.target.value)} placeholder="استخدم {{customerName}} أو {{name}}" />
          )}
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void previewMessage()} disabled={messagePreviewLoading}>
              {messagePreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'معاينة الرسالة'}
            </Button>
          </div>
          {messagePreview && (
            <div className="mt-3 rounded-xl border border-border bg-[#0b141a] p-3 text-sm whitespace-pre-wrap text-[#d9fdd3]">{messagePreview}</div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => void saveDraft()} disabled={saveLoading}>
            {saveLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حفظ مسودة'}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void (async () => {
                if (audienceCount == null) await previewAudience();
                if (!messagePreview) await previewMessage();
                setConfirmStartOpen(true);
              })();
            }}
            disabled={saveLoading || startLoading || audiencePreviewLoading || messagePreviewLoading}
          >
            بدء الحملة
          </Button>
        </div>

        <Dialog open={confirmStartOpen} onOpenChange={setConfirmStartOpen}>
          <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md">
            <DialogHeader>
              <DialogTitle>تأكيد بدء الحملة</DialogTitle>
              <DialogDescription className="text-zinc-400">
                سيتم إنشاء لقطة للمستلمين وإضافة {audienceCount ?? 0} رسالة إلى قائمة الإرسال (Outbox).
                لن يبدأ الإرسال تلقائيًا من هذه الشاشة — يعتمد على عامل الرسائل.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm text-zinc-300">
              <p>عدد المستلمين: <strong className="text-white">{audienceCount ?? '—'}</strong></p>
              {!messagePreview && (
                <p className="text-amber-300">لم تتم معاينة الرسالة بعد — يُفضّل المعاينة قبل التأكيد.</p>
              )}
            </div>
            {messagePreview && (
              <div className="rounded-xl border border-border bg-[#0b141a] p-3 text-sm whitespace-pre-wrap text-[#d9fdd3]">{messagePreview}</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmStartOpen(false)} disabled={startLoading}>إلغاء</Button>
              <Button
                onClick={() => void handleConfirmStart()}
                disabled={startLoading || !audienceCount || audienceCount <= 0}
              >
                {startLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'تأكيد البدء'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </section>
    );
  }

  if (view === 'detail' && selectedId != null) {
    const c = detail;
    const canCancel = c && ['draft', 'queued', 'running'].includes(c.status);
    const progressPct = c && c.progress.totalRecipients > 0
      ? Math.round(((c.progress.sentCount + c.progress.failedCount) / c.progress.totalRecipients) * 100)
      : 0;

    return (
      <section className="rounded-2xl border border-border bg-surface p-5 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => { setView('list'); setDetail(null); }}>
            <ArrowRight className="h-4 w-4" />
            رجوع للقائمة
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadDetail(selectedId)} disabled={detailLoading}>
            <RefreshCw className={`h-4 w-4 ${detailLoading ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
        </div>

        {detailLoading && !c ? (
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
        ) : c ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{c.name}</h2>
              <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABELS[c.status]}</Badge>
            </div>
            <p className="text-sm text-zinc-400">أُنشئت: {new Date(c.createdAt).toLocaleString('ar-EG')}</p>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>التقدم</span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <Stat label="إجمالي" value={c.progress.totalRecipients} />
                <Stat label="مُرسل" value={c.progress.sentCount} />
                <Stat label="معلق" value={c.progress.pendingCount + c.progress.queuedCount} />
                <Stat label="فشل" value={c.progress.failedCount} />
              </div>
            </div>

            {canCancel && (
              <Button type="button" variant="destructive" onClick={() => void cancelCampaign(c.id)} disabled={cancelLoading}>
                {cancelLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'إلغاء الحملة'}
              </Button>
            )}
          </>
        ) : (
          <p className="text-sm text-zinc-400">تعذر تحميل تفاصيل الحملة.</p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">الحملات</h2>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadCampaigns()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button type="button" size="sm" onClick={() => { resetCreateForm(); setView('create'); }}>
            <Plus className="h-4 w-4" />
            إنشاء حملة
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 text-rose-300 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-zinc-400">لا توجد حملات بعد. أنشئ حملتك الأولى.</p>
      ) : (
        <ul className="space-y-2">
          {campaigns.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => { setSelectedId(c.id); setView('detail'); }}
                className="w-full rounded-xl border border-border px-4 py-3 text-right hover:bg-muted/50 transition-colors"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-zinc-400 mt-1">
                      {c.sentCount}/{c.totalRecipients} مُرسل · {c.pendingCount} معلق · {c.failedCount} فشل
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                    <span className="text-xs text-zinc-500">{new Date(c.createdAt).toLocaleDateString('ar-EG')}</span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="text-base font-semibold">{value}</p>
    </div>
  );
}
