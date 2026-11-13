'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fetchPosReferralPreview,
  normalizePosReferralCode,
  type PosReferralPreviewOutcome,
  type ReferralPreviewReason,
} from '@/lib/referrals/posReferralPreview';

const REASON_TEXT: Record<ReferralPreviewReason, string> = {
  SELF_REFERRAL: 'مينفعش العميل يستخدم كود الإحالة بتاعه.',
  CODE_NOT_ACTIVE: 'الكود لسه مش نشط. لازم صاحب الكود يكون أكمل زيارة مدفوعة.',
  REFERRER_NOT_ELIGIBLE: 'صاحب الكود معندوش زيارة مدفوعة مؤهلة.',
  REFERRED_ALREADY_VISITED: 'العميل ده ليه زيارة مدفوعة قبل كده؛ العرض للزيارة الأولى فقط.',
  ALREADY_CLAIMED: 'العميل استخدم إحالة قبل كده، ومينفعش يكررها.',
};

function PreviewMessage({ outcome, applied }: { outcome: PosReferralPreviewOutcome; applied: boolean }) {
  if (outcome.state === 'eligible') {
    return (
      <p role="status" data-testid="referral-preview-result" className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
        {applied
          ? 'الخصم 50% متطبق على مسودة الفاتورة. هيتراجع تاني عند الحفظ.'
          : 'الكود صالح مبدئيًا للعرض (50%)، لكن الخصم مش مطبّق على الفاتورة.'}
      </p>
    );
  }

  const content =
    outcome.state === 'ineligible' ? REASON_TEXT[outcome.reason] :
    outcome.state === 'not_found' ? 'الكود أو العميل غير موجود ضمن بيانات المنشأة.' :
    outcome.state === 'not_ready' ? 'فحص الإحالات غير متاح حاليًا. مفيش خصم هيتطبق.' :
    outcome.state === 'unauthorized' ? 'جلسة الكاشير غير صالحة. سجّل الدخول تاني.' :
    'تعذر فحص الكود. جرّب مرة تانية.';

  return (
    <p role="status" data-testid="referral-preview-result" className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {content}
    </p>
  );
}

/**
 * Preview is always read-only. Applying the eligibility result is an explicit
 * cashier action when the parent supplies onApply (parent owns the build flag).
 * Backend rechecks the code and the fully paid invoice inside its transaction.
 * Parent keys by selected customer to prevent stale cross-customer code state.
 */
export default function PosReferralPreview({
  clientId, appliedCode = null, canApply = false, onApply, onRemove,
}: {
  clientId: number;
  appliedCode?: string | null;
  canApply?: boolean;
  onApply?: (code: string, clientId: number) => void;
  onRemove?: () => void;
}) {
  const [code, setCode] = useState(appliedCode ?? '');
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<PosReferralPreviewOutcome | null>(null);
  const [validationError, setValidationError] = useState('');
  const sequenceRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    sequenceRef.current += 1;
    abortRef.current?.abort();
  }, []);

  const handleCodeChange = (value: string) => {
    if (appliedCode) onRemove?.();
    sequenceRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setChecking(false);
    setCode(value);
    setOutcome(null);
    setValidationError('');
  };

  async function handleCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sequenceRef.current += 1;
    abortRef.current?.abort();
    const sequence = sequenceRef.current;
    const normalized = normalizePosReferralCode(code);
    setOutcome(null);
    setValidationError('');
    if (!normalized) {
      setChecking(false);
      setValidationError('اكتب الكود كامل بصيغة CUT- وبعده 24 حرف أو رقم.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setChecking(true);
    try {
      const result = await fetchPosReferralPreview(clientId, normalized, controller.signal);
      if (sequence === sequenceRef.current && !controller.signal.aborted) {
        setOutcome(result);
      }
    } catch {
      if (sequence === sequenceRef.current && !controller.signal.aborted) {
        setOutcome({ state: 'error' });
      }
    } finally {
      if (sequence === sequenceRef.current) {
        abortRef.current = null;
        setChecking(false);
      }
    }
  }

  return (
    <section
      className="rounded-lg border border-border bg-card p-3 space-y-3"
      dir="rtl"
      aria-label="فحص كود الإحالة"
      data-testid="pos-referral-preview"
    >
      <div className="flex items-center gap-2">
        <Tag className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">كود إحالة العميل</h3>
        <span className="text-[10px] rounded bg-muted px-2 py-0.5 text-muted-foreground">معاينة</span>
      </div>
      <form onSubmit={handleCheck} className="flex gap-2">
        <Input
          aria-label="كود الإحالة"
          data-testid="referral-code-input"
          dir="ltr"
          autoComplete="off"
          inputMode="text"
          value={code}
          onChange={(event) => handleCodeChange(event.target.value)}
          placeholder="CUT-XXXXXXXXXXXXXXXXXXXXXXXX"
          className="h-10 min-w-0 flex-1 text-xs"
          maxLength={40}
        />
        <Button
          type="submit"
          variant="outline"
          className="h-10 shrink-0"
          disabled={checking || !code.trim()}
          data-testid="referral-check-button"
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-label="جاري الفحص" /> : 'فحص'}
        </Button>
      </form>
      {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}
      {outcome ? <PreviewMessage outcome={outcome} applied={Boolean(appliedCode)} /> : null}
      {onApply && outcome?.state === 'eligible' && !appliedCode ? (
        <div className="space-y-2">
          <Button
            type="button"
            data-testid="referral-apply-button"
            className="w-full"
            disabled={!canApply || checking}
            onClick={() => {
              const normalized = normalizePosReferralCode(code);
              if (normalized && canApply) onApply(normalized, clientId);
            }}
          >
            تطبيق خصم الإحالة 50%
          </Button>
          {!canApply && (
            <p role="alert" className="text-xs text-destructive">
              لازم تضيف خدمة مؤهلة، ومن غير خصومات يدوية أو خصومات خدمات، قبل تطبيق الإحالة.
            </p>
          )}
        </div>
      ) : null}
      {appliedCode && onRemove ? (
        <div className="space-y-1">
          <p role="status" className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            تم تطبيق خصم 50% على المسودة، وهنتأكد من الأهلية وقت الدفع.
          </p>
          <Button
            type="button"
            variant="outline"
            data-testid="referral-remove-button"
            className="w-full"
            onClick={() => {
              onRemove();
              setOutcome(null);
              setCode('');
            }}
          >
            إلغاء خصم الإحالة
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground" data-testid="referral-preview-disclaimer">
        {appliedCode
          ? 'خصم المسودة مبدئي — السيرفر سيؤكد الإحالة والدفع قبل إصدار أي مكافأة.'
          : 'معاينة فقط — لن يُطبّق أي خصم إلا بعد الضغط على تطبيق، ولن تُصدر مكافأة من الفحص.'}
      </p>
    </section>
  );
}
