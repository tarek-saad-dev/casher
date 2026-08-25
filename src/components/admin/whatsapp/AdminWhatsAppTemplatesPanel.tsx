'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
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
import {
  whatsappSourceBadgeVariant,
  whatsappSourceLabel,
} from '@/lib/whatsapp/adminTemplateUi';
import type { MessageTemplateSource } from '@/modules/messaging/domain/templateTypes';

type AdminTemplateOverrideView = {
  id: number;
  content: string;
  version: number;
  isActive: boolean;
  updatedAt?: string;
};

type TemplateVariable = {
  key: string;
  token: string;
  label: string;
  sample?: string;
};

export type AdminWhatsAppTemplateView = {
  templateKey: string;
  channel: 'whatsapp';
  language: 'ar';
  label: string;
  description: string;
  availableVariables: TemplateVariable[];
  effectiveContent: string;
  effectiveSource: MessageTemplateSource;
  branchOverride: AdminTemplateOverrideView | null;
  globalTemplate: AdminTemplateOverrideView | null;
};

function jsonHeaders(res: Response): boolean {
  return (res.headers.get('content-type') || '').includes('application/json');
}

function hasActiveBranchOverride(template: AdminWhatsAppTemplateView | null): boolean {
  return template?.branchOverride?.isActive === true;
}

function insertTextAtCursor(
  el: HTMLTextAreaElement,
  current: string,
  token: string,
): { next: string; cursor: number } {
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? start;
  return {
    next: `${current.slice(0, start)}${token}${current.slice(end)}`,
    cursor: start + token.length,
  };
}

type Props = {
  branchId: number | null;
  onToast: (type: 'success' | 'error', message: string) => void;
};

export default function AdminWhatsAppTemplatesPanel({ branchId, onToast }: Props) {
  const [templates, setTemplates] = useState<AdminWhatsAppTemplateView[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selected = useMemo(
    () => templates.find((t) => t.templateKey === selectedKey) ?? null,
    [templates, selectedKey],
  );

  const dirty = Boolean(selected) && draft !== selected!.effectiveContent;
  const saveDisabled =
    !selected || !dirty || !draft.trim() || saveLoading || restoreLoading;

  const applyTemplate = useCallback((template: AdminWhatsAppTemplateView | null) => {
    setSelectedKey(template?.templateKey ?? null);
    setDraft(template?.effectiveContent ?? '');
    setPreviewText(null);
    setPreviewError(null);
  }, []);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const res = await fetch('/api/admin/whatsapp/templates');
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر تحميل الرسائل'));
      }
      const data = (await res.json()) as { templates?: AdminWhatsAppTemplateView[] };
      const list = Array.isArray(data.templates) ? data.templates : [];
      setTemplates(list);
      setSelectedKey(list[0]?.templateKey ?? null);
      setDraft(list[0]?.effectiveContent ?? '');
      setPreviewText(null);
      setPreviewError(null);
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : 'تعذر تحميل الرسائل');
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates, branchId]);

  const refetchSelected = useCallback(
    async (fallback?: AdminWhatsAppTemplateView) => {
      if (!selectedKey) return;
      const res = await fetch(
        `/api/admin/whatsapp/templates/${encodeURIComponent(selectedKey)}`,
      );
      if (!res.ok) {
        if (fallback) {
          setTemplates((prev) =>
            prev.map((t) => (t.templateKey === fallback.templateKey ? fallback : t)),
          );
          applyTemplate(fallback);
          return;
        }
        throw new Error(await readFetchErrorMessage(res, 'تعذر تحديث الرسالة'));
      }
      const data = (await res.json()) as { template?: AdminWhatsAppTemplateView };
      if (!data.template) throw new Error('تعذر تحديث الرسالة');
      setTemplates((prev) =>
        prev.map((t) => (t.templateKey === data.template!.templateKey ? data.template! : t)),
      );
      applyTemplate(data.template);
    },
    [applyTemplate, selectedKey],
  );

  const handleSave = async () => {
    if (!selected || saveDisabled) return;
    setSaveLoading(true);
    try {
      const res = await fetch(
        `/api/admin/whatsapp/templates/${encodeURIComponent(selected.templateKey)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: 'ar', content: draft }),
        },
      );
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر حفظ رسالة الفرع'));
      }
      const data = (await res.json()) as { template?: AdminWhatsAppTemplateView };
      await refetchSelected(data.template);
      onToast('success', 'تم حفظ رسالة الفرع');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذر حفظ رسالة الفرع');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!selected) return;
    setRestoreLoading(true);
    try {
      const res = await fetch(
        `/api/admin/whatsapp/templates/${encodeURIComponent(selected.templateKey)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'تعذر إلغاء تخصيص الفرع'));
      }
      const data = (await res.json()) as { template?: AdminWhatsAppTemplateView };
      setRestoreOpen(false);
      await refetchSelected(data.template);
      onToast('success', 'تم إلغاء تخصيص الفرع');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذر إلغاء تخصيص الفرع');
    } finally {
      setRestoreLoading(false);
    }
  };

  const handlePreview = async () => {
    if (!selected) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewText(null);
    try {
      const res = await fetch(
        `/api/admin/whatsapp/templates/${encodeURIComponent(selected.templateKey)}/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: draft }),
        },
      );
      const data = jsonHeaders(res)
        ? ((await res.json()) as { ok?: boolean; rendered?: string; error?: string })
        : null;
      if (!res.ok) {
        throw new Error(
          (typeof data?.error === 'string' && data.error.trim()) ||
            `تعذر عرض المعاينة (HTTP ${res.status})`,
        );
      }
      if (typeof data?.rendered !== 'string') {
        throw new Error('تعذر عرض المعاينة');
      }
      setPreviewText(data.rendered);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'تعذر عرض المعاينة');
    } finally {
      setPreviewLoading(false);
    }
  };

  const insertVariable = (token: string) => {
    const el = textareaRef.current;
    if (!el) {
      setDraft((prev) => `${prev}${token}`);
      return;
    }
    const { next, cursor } = insertTextAtCursor(el, draft, token);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const copyVariable = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      onToast('success', `تم نسخ ${token}`);
    } catch {
      insertVariable(token);
    }
  };

  if (templatesError) {
    return (
      <section className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
            <div>
              <p className="text-sm font-medium text-rose-200">تعذر تحميل الرسائل</p>
              <p className="mt-1 text-sm text-rose-300/90">{templatesError}</p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadTemplates()}>
            إعادة المحاولة
          </Button>
        </div>
      </section>
    );
  }

  if (templatesLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-8 text-center">
        <p className="text-sm text-zinc-400">لا توجد رسائل نظام متاحة حالياً.</p>
      </section>
    );
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
        <section className="rounded-2xl border border-border bg-surface p-3">
          <h2 className="mb-3 px-2 text-sm font-semibold text-foreground">الرسائل</h2>
          <ul className="space-y-2">
            {templates.map((template) => {
              const active = template.templateKey === selectedKey;
              return (
                <li key={template.templateKey}>
                  <button
                    type="button"
                    onClick={() => applyTemplate(template)}
                    className={`w-full rounded-xl border px-3 py-3 text-right transition-colors ${
                      active
                        ? 'border-primary/50 bg-primary/10'
                        : 'border-transparent hover:bg-muted/60'
                    }`}
                  >
                    <p className="text-sm font-medium text-foreground">{template.label}</p>
                    <p className="mt-1 text-xs text-zinc-400">{template.description}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {selected && (
          <section className="rounded-2xl border border-border bg-surface p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge variant={whatsappSourceBadgeVariant(selected.effectiveSource)}>
                {whatsappSourceLabel(selected.effectiveSource)}
              </Badge>
              {hasActiveBranchOverride(selected) && (
                <Badge variant="outline">هذا الفرع لديه تخصيص</Badge>
              )}
            </div>

            <label className="mb-2 block text-sm font-medium text-foreground">نص الرسالة</label>
            <Textarea
              ref={textareaRef}
              dir="rtl"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[220px] resize-y bg-background text-base leading-7"
              placeholder="اكتب رسالة واتساب هنا…"
            />

            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-foreground">المتغيرات</p>
              <div className="flex flex-wrap gap-2">
                {selected.availableVariables.map((variable) => (
                  <button
                    key={variable.key}
                    type="button"
                    onClick={() => insertVariable(variable.token)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      void copyVariable(variable.token);
                    }}
                    title={`إدراج ${variable.token} — انقر بزر أيمن للنسخ`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs hover:bg-muted"
                  >
                    <span className="font-mono" dir="ltr">
                      {variable.token}
                    </span>
                    <span className="text-zinc-400">{variable.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => void handleSave()} disabled={saveDisabled}>
                {saveLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري الحفظ…
                  </>
                ) : (
                  'حفظ رسالة الفرع'
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handlePreview()}
                disabled={previewLoading || restoreLoading}
              >
                {previewLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري المعاينة…
                  </>
                ) : (
                  'معاينة'
                )}
              </Button>
              {hasActiveBranchOverride(selected) && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setRestoreOpen(true)}
                  disabled={restoreLoading || saveLoading}
                >
                  استخدام الرسالة العامة
                </Button>
              )}
            </div>

            {previewError && (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-sm text-rose-300">
                {previewError}
              </div>
            )}

            {(previewLoading || previewText) && (
              <div className="mt-4 rounded-2xl border border-border bg-[#0b141a] p-4">
                <p className="mb-3 text-xs text-zinc-400">معاينة الرسالة</p>
                {previewLoading ? (
                  <div className="h-24 animate-pulse rounded-2xl bg-white/10" />
                ) : (
                  <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-[#d9fdd3] px-3 py-2 text-sm leading-6 text-[#111b21] whitespace-pre-wrap">
                    {previewText}
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      <Dialog
        open={restoreOpen}
        onOpenChange={(open) => {
          if (restoreLoading) return;
          setRestoreOpen(open);
        }}
      >
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>استخدام الرسالة العامة</DialogTitle>
            <DialogDescription className="text-zinc-400">
              سيتم إلغاء تخصيص هذا الفرع والرجوع إلى الرسالة العامة أو الافتراضية. لن تُحذف الرسالة.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={restoreLoading}
              onClick={() => setRestoreOpen(false)}
            >
              إلغاء
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={restoreLoading}
              onClick={() => void handleRestore()}
            >
              {restoreLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري التراجع…
                </>
              ) : (
                'تأكيد استخدام الرسالة العامة'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
