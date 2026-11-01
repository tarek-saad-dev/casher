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
  | 'failed'
  | 'paused';

type NovSegment = 'VIP' | 'HAIR_CARE' | 'HAIRCUT_REGULAR';

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
  mode: 'all' | 'rules' | 'segment' | 'nov_pro600';
  segmentType?: 'today' | 'this_week' | 'two_weeks' | 'one_month';
  novPro600Segments?: NovSegment[];
  asOfDate?: string;
  branchId?: number;
};

type NovPreview = {
  matchingCount: number;
  sendEligibleCount: number;
  optedOutCount: number;
  suppressedCount: number;
  consentBlocker: string | null;
  bySegment: Record<
    NovSegment,
    { matching: number; sendEligible: number; optedOut: number; suppressed: number }
  >;
  sample: Array<{
    clientId: number;
    name: string;
    phoneMasked: string;
    segment: NovSegment;
    branchName: string | null;
    sendEligible: boolean;
    exclusionReason: string | null;
  }>;
};

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'مسودة',
  queued: 'في الانتظار',
  running: 'جارية',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  failed: 'فشلت',
  paused: 'متوقفة',
};

const STATUS_VARIANT: Record<CampaignStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  queued: 'outline',
  running: 'default',
  completed: 'default',
  cancelled: 'destructive',
  failed: 'destructive',
  paused: 'outline',
};

const SEGMENT_LABELS: Record<NovSegment, string> = {
  VIP: 'VIP',
  HAIR_CARE: 'عناية الشعر',
  HAIRCUT_REGULAR: 'حلاقة منتظمة',
};

const DEFAULT_NOV_MESSAGE = `أهلاً {{first_name}} 👋

عرض نوفمبر في CUT Salon ({{branch_name}}):

✨ باقة NOV-PRO600 بسعر 600 جنيه فقط
قص شعر + بروتين شعر قصير + فوطة ساخنة/باردة + ماسك عناية

مناسب للشعر القصير بعد تقييم المختص في الصالون.
احجز موعدك خلال نوفمبر.

فريق CUT Salon`;

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

  const [name, setName] = useState('NOV-PRO600 — عرض بروتين نوفمبر');
  const [selectedSegments, setSelectedSegments] = useState<NovSegment[]>([
    'VIP',
    'HAIR_CARE',
    'HAIRCUT_REGULAR',
  ]);
  const [templateKey, setTemplateKey] = useState('whatsapp.campaign');
  const [customMessage, setCustomMessage] = useState(DEFAULT_NOV_MESSAGE);
  const [novPreview, setNovPreview] = useState<NovPreview | null>(null);
  const [audiencePreviewLoading, setAudiencePreviewLoading] = useState(false);
  const [messagePreview, setMessagePreview] = useState<string | null>(null);
  const [messagePreviewLoading, setMessagePreviewLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [pauseLoading, setPauseLoading] = useState(false);
  const [confirmStartOpen, setConfirmStartOpen] = useState(false);
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [draftCampaignId, setDraftCampaignId] = useState<number | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testSendLoading, setTestSendLoading] = useState(false);

  const audienceCriteria = useMemo((): AudienceCriteria => {
    return {
      mode: 'nov_pro600',
      novPro600Segments: selectedSegments,
      asOfDate: '2026-11-01',
      branchId: branchId ?? undefined,
    };
  }, [selectedSegments, branchId]);

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
      const campaignTpl = list.find((t) => t.templateKey === 'whatsapp.campaign');
      if (campaignTpl) setTemplateKey(campaignTpl.templateKey);
      else if (list[0] && !templateKey) setTemplateKey(list[0].templateKey);
    } catch {
      /* optional */
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

  const toggleSegment = (seg: NovSegment) => {
    setSelectedSegments((prev) => {
      if (prev.includes(seg)) {
        if (prev.length === 1) return prev;
        return prev.filter((s) => s !== seg);
      }
      return [...prev, seg];
    });
    setNovPreview(null);
  };

  const previewAudienceCount = async () => {
    setAudiencePreviewLoading(true);
    setNovPreview(null);
    try {
      const res = await fetch('/api/admin/whatsapp/campaigns/audience/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audienceCriteria),
      });
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر معاينة الجمهور'));
      }
      const data = (await res.json()) as { preview?: { novPro600?: NovPreview; count?: number } };
      if (data.preview?.novPro600) {
        setNovPreview(data.preview.novPro600);
      } else {
        setNovPreview({
          matchingCount: data.preview?.count ?? 0,
          sendEligibleCount: data.preview?.count ?? 0,
          optedOutCount: 0,
          suppressedCount: 0,
          consentBlocker: null,
          bySegment: {
            VIP: { matching: 0, sendEligible: 0, optedOut: 0, suppressed: 0 },
            HAIR_CARE: { matching: 0, sendEligible: 0, optedOut: 0, suppressed: 0 },
            HAIRCUT_REGULAR: { matching: 0, sendEligible: 0, optedOut: 0, suppressed: 0 },
          },
          sample: [],
        });
      }
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
          // Preview the editable draft body with personalization vars
          messageMode: 'custom',
          templateKey: null,
          customMessage,
          sampleName: 'أحمد محمد',
          sampleBranchName: 'جليم – سابا باشا',
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
    if (selectedSegments.length === 0) {
      onToast('error', 'اختر شريحة واحدة على الأقل');
      return null;
    }
    setSaveLoading(true);
    try {
      const res = await fetch('/api/admin/whatsapp/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          messageMode: 'template',
          templateKey,
          customMessage: null,
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
    if (!approvalChecked) {
      onToast('error', 'يجب تأكيد الموافقة الصريحة قبل البدء');
      return;
    }
    setStartLoading(true);
    try {
      const res = await fetch(`/api/admin/whatsapp/campaigns/${campaignId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ explicitApproval: true }),
      });
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر بدء الحملة'));
      }
      onToast('success', 'تم بدء الحملة وإضافة الرسائل إلى قائمة الإرسال');
      setConfirmStartOpen(false);
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
    if (!id) id = await saveDraft();
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

  const pauseCampaign = async (campaignId: number) => {
    setPauseLoading(true);
    try {
      const res = await fetch(`/api/admin/whatsapp/campaigns/${campaignId}/pause`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر إيقاف الحملة'));
      }
      onToast('success', 'تم إيقاف الحملة مؤقتًا');
      await loadDetail(campaignId);
      await loadCampaigns();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذر إيقاف الحملة');
    } finally {
      setPauseLoading(false);
    }
  };

  const sendTest = async () => {
    setTestSendLoading(true);
    try {
      const res = await fetch('/api/admin/whatsapp/campaigns/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: testPhone,
          messageMode: 'template',
          templateKey,
          sampleName: 'مشرف الاختبار',
          sampleBranchName: 'جليم – سابا باشا',
        }),
      });
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر إرسال رسالة الاختبار'));
      }
      onToast('success', 'تم وضع رسالة الاختبار في قائمة الإرسال');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذر إرسال رسالة الاختبار');
    } finally {
      setTestSendLoading(false);
    }
  };

  const resetCreateForm = () => {
    setName('NOV-PRO600 — عرض بروتين نوفمبر');
    setSelectedSegments(['VIP', 'HAIR_CARE', 'HAIRCUT_REGULAR']);
    setTemplateKey('whatsapp.campaign');
    setCustomMessage(DEFAULT_NOV_MESSAGE);
    setNovPreview(null);
    setMessagePreview(null);
    setDraftCampaignId(null);
    setApprovalChecked(false);
    setTestPhone('');
  };

  if (view === 'create') {
    return (
      <section className="rounded-2xl border border-border bg-surface p-5 space-y-6" dir="rtl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setView('list'); resetCreateForm(); }}>
              <ArrowRight className="h-4 w-4" />
              رجوع
            </Button>
            <h2 className="text-base font-semibold">حملة NOV-PRO600</h2>
          </div>
          <Badge variant="outline">600 ج.م · نوفمبر 2026</Badge>
        </div>

        <p className="text-sm text-zinc-400">
          قص شعر + بروتين شعر قصير + فوطة ساخنة/باردة + ماسك عناية — للشعر القصير بعد تقييم المختص.
        </p>

        <div>
          <label className="mb-1 block text-sm font-medium">اسم الحملة</label>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">شرائح الجمهور (حصرية)</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {(Object.keys(SEGMENT_LABELS) as NovSegment[]).map((seg) => (
              <Button
                key={seg}
                type="button"
                size="sm"
                variant={selectedSegments.includes(seg) ? 'default' : 'outline'}
                onClick={() => toggleSegment(seg)}
              >
                {SEGMENT_LABELS[seg]}
                {novPreview ? ` · ${novPreview.bySegment[seg]?.matching ?? 0}` : ''}
              </Button>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void previewAudienceCount()} disabled={audiencePreviewLoading}>
            {audiencePreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حساب الجمهور من البيانات الحية'}
          </Button>

          {novPreview && (
            <div className="mt-3 space-y-2 rounded-xl border border-border bg-background/40 p-3 text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="مطابق سلوكيًا" value={novPreview.matchingCount} />
                <Stat label="مؤهل للإرسال" value={novPreview.sendEligibleCount} />
                <Stat label="مستبعد" value={novPreview.suppressedCount} />
                <Stat label="إلغاء اشتراك" value={novPreview.optedOutCount} />
              </div>
              {novPreview.consentBlocker && (
                <p className="text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{novPreview.consentBlocker}</span>
                </p>
              )}
              {novPreview.sample.length > 0 && (
                <div className="max-h-40 overflow-auto text-xs text-zinc-400 space-y-1">
                  {novPreview.sample.slice(0, 10).map((r) => (
                    <div key={r.clientId} className="flex justify-between gap-2">
                      <span>{r.name} · {r.phoneMasked}</span>
                      <span>{SEGMENT_LABELS[r.segment]}{r.sendEligible ? '' : ' · غير مؤهل'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">الرسالة (قابلة للتعديل للمعاينة/المسودة)</p>
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm mb-2"
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value)}
          >
            {templates.length === 0 ? (
              <option value="whatsapp.campaign">whatsapp.campaign</option>
            ) : (
              templates.map((t) => (
                <option key={t.templateKey} value={t.templateKey}>{t.label}</option>
              ))
            )}
          </select>
          <p className="text-xs text-zinc-500 mb-2">
            المتغيرات: {'{{first_name}}'} · {'{{branch_name}}'} · القالب المعتمد للإرسال: {templateKey}
          </p>
          <Textarea
            dir="rtl"
            className="min-h-[160px] mb-2"
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
          />
          <p className="text-xs text-amber-300/80 mb-2">
            المعاينة تستخدم النص أعلاه. بدء الحملة لـ NOV-PRO600 يمر عبر مفتاح القالب المعتمد فقط بعد موافقة القناة الرسمية — لا إرسال جماعي عبر واتساب ويب غير مصرح.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void previewMessage()} disabled={messagePreviewLoading}>
              {messagePreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'معاينة الرسالة'}
            </Button>
          </div>
          {messagePreview && (
            <div className="mt-3 rounded-xl border border-border bg-[#0b141a] p-3 text-sm whitespace-pre-wrap text-[#d9fdd3]">{messagePreview}</div>
          )}
        </div>

        <div className="rounded-xl border border-dashed border-border p-3 space-y-2">
          <p className="text-sm font-medium">إرسال اختبار لمشرف مصرح</p>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            dir="ltr"
            placeholder="رقم في WHATSAPP_CAMPAIGN_TEST_PHONES"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => void sendTest()} disabled={testSendLoading || !testPhone.trim()}>
            {testSendLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'إرسال اختبار'}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => void saveDraft()} disabled={saveLoading}>
            {saveLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حفظ مسودة'}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void (async () => {
                if (!novPreview) await previewAudienceCount();
                if (!messagePreview) await previewMessage();
                setApprovalChecked(false);
                setConfirmStartOpen(true);
              })();
            }}
            disabled={saveLoading || startLoading || audiencePreviewLoading}
          >
            مراجعة وبدء الحملة
          </Button>
        </div>

        <Dialog open={confirmStartOpen} onOpenChange={setConfirmStartOpen}>
          <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle>موافقة صريحة لبدء NOV-PRO600</DialogTitle>
              <DialogDescription className="text-zinc-400">
                سيتم إضافة المستلمين المؤهلين فقط (بموافقة تسويقية موثقة) إلى Outbox عبر القناة الرسمية.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm text-zinc-300">
              <p>مطابق سلوكيًا: <strong className="text-white">{novPreview?.matchingCount ?? '—'}</strong></p>
              <p>مؤهل للإرسال: <strong className="text-white">{novPreview?.sendEligibleCount ?? '—'}</strong></p>
              {novPreview?.consentBlocker && (
                <p className="text-amber-300">{novPreview.consentBlocker}</p>
              )}
              <label className="flex items-start gap-2 pt-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={approvalChecked}
                  onChange={(e) => setApprovalChecked(e.target.checked)}
                />
                <span>أؤكد الموافقة الصريحة على بدء هذه الحملة للعملاء المؤهلين فقط.</span>
              </label>
            </div>
            {messagePreview && (
              <div className="rounded-xl border border-border bg-[#0b141a] p-3 text-sm whitespace-pre-wrap text-[#d9fdd3]">{messagePreview}</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmStartOpen(false)} disabled={startLoading}>إلغاء</Button>
              <Button
                onClick={() => void handleConfirmStart()}
                disabled={
                  startLoading
                  || !approvalChecked
                  || !novPreview
                  || novPreview.sendEligibleCount <= 0
                }
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
    const canCancel = c && ['draft', 'queued', 'running', 'paused'].includes(c.status);
    const canPause = c && ['queued', 'running'].includes(c.status);
    const canResume = c && c.status === 'paused';
    const progressPct = c && c.progress.totalRecipients > 0
      ? Math.round(((c.progress.sentCount + c.progress.failedCount) / c.progress.totalRecipients) * 100)
      : 0;

    return (
      <section className="rounded-2xl border border-border bg-surface p-5 space-y-5" dir="rtl">
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                <Stat label="إجمالي" value={c.progress.totalRecipients} />
                <Stat label="مُرسل" value={c.progress.sentCount} />
                <Stat label="معلق" value={c.progress.pendingCount + c.progress.queuedCount} />
                <Stat label="فشل" value={c.progress.failedCount} />
                <Stat label="متوقف/ملغى" value={c.progress.cancelledCount} />
                <Stat label="تخطّي" value={c.progress.skippedCount} />
              </div>
              <p className="text-xs text-zinc-500">
                حالات التسليم/الردود تعتمد على مزوّد واتساب الرسمي عند توفرها في الـinbox.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {canPause && (
                <Button type="button" variant="outline" onClick={() => void pauseCampaign(c.id)} disabled={pauseLoading}>
                  {pauseLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'إيقاف مؤقت'}
                </Button>
              )}
              {canResume && (
                <Button
                  type="button"
                  onClick={() => {
                    setApprovalChecked(true);
                    void startCampaign(c.id);
                  }}
                  disabled={startLoading}
                >
                  {startLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'استئناف'}
                </Button>
              )}
              {canCancel && (
                <Button type="button" variant="destructive" onClick={() => void cancelCampaign(c.id)} disabled={cancelLoading}>
                  {cancelLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'إلغاء الحملة'}
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-400">تعذر تحميل تفاصيل الحملة.</p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5" dir="rtl">
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
            حملة NOV-PRO600
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
        <p className="text-sm text-zinc-400">لا توجد حملات بعد. أنشئ حملة NOV-PRO600.</p>
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
