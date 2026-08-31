'use client';

import { useCallback, useState } from 'react';

type PreviewCard = {
  artifactIndex: number;
  titleAr: string;
  summaryAr: string;
  impactAr: string;
  conflictType: string;
  canApprove: boolean;
  blockedReasonAr?: string;
};

type ArtifactRow = {
  artifactId: number;
  title: string;
  summary: string;
  status: string;
};

type AnalyzeResponse = {
  ok: boolean;
  error?: string;
  previewCards?: PreviewCard[];
  artifacts?: ArtifactRow[];
  interpretation?: { intentSummary: string; ambiguities?: string[] };
  blocked?: boolean;
};

export function TeachCutAiPanel() {
  const [rawInput, setRawInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [submissionId, setSubmissionId] = useState<number | null>(null);
  const [preview, setPreview] = useState<AnalyzeResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setPreview(null);
    try {
      const createRes = await fetch('/api/admin/ai-concierge/learning/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawInput }),
      });
      const created = await createRes.json();
      if (!created.ok) {
        setMessage(created.error === 'feature_disabled' ? 'الميزة غير مفعّلة بعد.' : String(created.error));
        return;
      }
      const sid = created.submission.submissionId as number;
      setSubmissionId(sid);
      const analyzeRes = await fetch(`/api/admin/ai-concierge/learning/submissions/${sid}/analyze`, {
        method: 'POST',
      });
      const analyzed: AnalyzeResponse = await analyzeRes.json();
      if (!analyzed.ok) {
        setMessage(String(analyzed.error));
        return;
      }
      setPreview(analyzed);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setLoading(false);
    }
  }, [rawInput]);

  const approveAll = useCallback(async () => {
    if (!preview?.artifacts?.length) return;
    setLoading(true);
    setMessage(null);
    try {
      for (const a of preview.artifacts) {
        if (a.status !== 'NEEDS_REVIEW') continue;
        const res = await fetch(`/api/admin/ai-concierge/learning/artifacts/${a.artifactId}/approve`, {
          method: 'POST',
        });
        const body = await res.json();
        if (!body.ok) {
          setMessage(body.error ?? 'تعذر الاعتماد');
          return;
        }
      }
      setMessage('تم الاعتماد بنجاح.');
      setPreview(null);
      setRawInput('');
    } finally {
      setLoading(false);
    }
  }, [preview]);

  const rejectAll = useCallback(async () => {
    if (!preview?.artifacts?.length) return;
    setLoading(true);
    for (const a of preview.artifacts) {
      await fetch(`/api/admin/ai-concierge/learning/artifacts/${a.artifactId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    }
    setMessage('تم الرفض.');
    setPreview(null);
    setLoading(false);
  }, [preview]);

  return (
    <div dir="rtl" className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="mb-2 text-xl font-semibold text-neutral-900">علّم CUT AI</h2>
      <p className="mb-4 text-sm text-neutral-600">
        اكتب معلومة، تصحيح، قاعدة أو مثال بلغة طبيعية — النظام يحلّل ويعرض المعاينة قبل الاعتماد.
      </p>
      <textarea
        className="mb-3 min-h-[120px] w-full rounded-md border border-neutral-300 p-3 text-base"
        placeholder="مثال: كامب بيفتح الساعة 12 مش 11"
        value={rawInput}
        onChange={(e) => setRawInput(e.target.value)}
        disabled={loading}
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
          onClick={analyze}
          disabled={loading || !rawInput.trim()}
        >
          {loading ? 'جاري التحليل…' : 'تحليل'}
        </button>
      </div>

      {message && <p className="mt-4 text-sm text-neutral-700">{message}</p>}

      {preview?.interpretation && (
        <div className="mt-6 space-y-4 rounded-md bg-neutral-50 p-4">
          <p className="font-medium">فهمت إنك تريد:</p>
          <p className="text-neutral-800">{preview.interpretation.intentSummary}</p>
          {preview.interpretation.ambiguities?.length ? (
            <p className="text-amber-800">المعلومة محتاجة تحديد أكتر قبل اعتمادها.</p>
          ) : null}
          {(preview.previewCards ?? []).map((card) => (
            <div key={card.artifactIndex} className="rounded border border-neutral-200 bg-white p-3">
              <div className="font-semibold">{card.titleAr}</div>
              <div className="text-sm text-neutral-700">{card.summaryAr}</div>
              <div className="mt-1 text-sm text-neutral-600">{card.impactAr}</div>
              {card.blockedReasonAr && (
                <div className="mt-2 text-sm text-red-700">لا يمكن اعتماد التوجيه: {card.blockedReasonAr}</div>
              )}
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded border px-4 py-2"
              onClick={rejectAll}
              disabled={loading}
            >
              رفض
            </button>
            <button
              type="button"
              className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50"
              onClick={approveAll}
              disabled={loading || preview.blocked || !preview.artifacts?.some((a) => a.status === 'NEEDS_REVIEW')}
            >
              اعتماد الكل
            </button>
          </div>
          {submissionId != null && (
            <p className="text-xs text-neutral-400">معرّف الجلسة: {submissionId}</p>
          )}
        </div>
      )}
    </div>
  );
}
