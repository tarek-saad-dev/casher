'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CompensationBranch } from '@/components/hr/EmployeeBranchPayrollFields';

type Preview = {
  effectiveFrom: string;
  previousDailyAmount: number;
  previousLedgerCredits: number;
  proposedMonthlyAmount: number;
  difference: number;
  dailyCount: number;
  paidOut: number;
  advances: number;
  deductions: number;
  proratedDays: number;
  daysInMonth: number;
  blockers: string[];
  fingerprint: string;
  branchImpacts: Array<{
    branchId: number; dailyCount: number; oldLedgerCredits: number;
    monthlySalary: number; newEntitlement: number; difference: number;
  }>;
};

export type RetroReviewActionState = {
  canReview: boolean;
  canApprove: boolean;
  busy: boolean;
  hasPreview: boolean;
  blocked: boolean;
  applying: boolean;
};

export type RetroReviewHandle = {
  submit: () => Promise<void>;
};

type Props = {
  empId: number;
  effectiveFrom: string;
  branches: CompensationBranch[];
  readiness?: { schemaReady: boolean; enabledForEmployee: boolean };
  onApplied: (message: string) => void;
  onActionStateChange: (state: RetroReviewActionState) => void;
};

const amount = (value: number) => new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
}).format(value) + ' ج.م';

const RetroPayrollAgreementReview = forwardRef<RetroReviewHandle, Props>(
  function RetroPayrollAgreementReview({
    empId, effectiveFrom, branches, readiness, onApplied, onActionStateChange,
  }, ref) {
    const [reason, setReason] = useState('');
    const [preview, setPreview] = useState<Preview | null>(null);
    const [previewSignature, setPreviewSignature] = useState('');
    const [loading, setLoading] = useState(false);
    const [applying, setApplying] = useState(false);
    const [error, setError] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const requestKey = useRef<string | null>(null);

    const signature = JSON.stringify({
      effectiveFrom,
      branches: branches.map((b) => [b.branchId, b.enabled, b.monthlySalary]),
      reason: reason.trim(),
    });
    const validBranches = branches.some((b) => b.enabled) &&
      branches.filter((b) => b.enabled).every((b) => b.isAssigned &&
        Number.isFinite(Number(b.monthlySalary)) && Number(b.monthlySalary) > 0);
    const busy = loading || applying;
    const currentPreview = previewSignature === signature ? preview : null;
    const schemaReady = readiness?.schemaReady === true;
    const rolloutEnabled = readiness?.enabledForEmployee === true;
    const canReview = schemaReady && !busy && reason.trim().length >= 8 && validBranches;
    const blocked = Boolean(currentPreview?.blockers.length);
    const canApprove = Boolean(currentPreview && !blocked && !busy && confirmed && rolloutEnabled);

    // A preview is only usable for the exact fields that the user reviewed.
    useEffect(() => {
      onActionStateChange({
        canReview, canApprove, busy, blocked,
        hasPreview: Boolean(currentPreview), applying,
      });
    }, [onActionStateChange, canReview, canApprove, busy, blocked, currentPreview, applying]);

    useEffect(() => {
      requestKey.current = null;
      setConfirmed(false);
      setError('');
    }, [signature]);

    const requestBody = () => ({
      effectiveFrom,
      reason: reason.trim(),
      branches: branches.map((b) => ({
        branchId: b.branchId,
        enabled: b.enabled,
        monthlySalary: Number(b.monthlySalary) || 0,
      })),
    });

    const request = async (action: 'preview' | 'apply') => {
      const response = await fetch(
        '/api/admin/employees/' + empId + '/payroll-agreement/' + action,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action === 'apply'
            ? { ...requestBody(), requestKey: requestKey.current, expectedFingerprint: currentPreview?.fingerprint }
            : requestBody()),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'تعذر فحص الاتفاقية؛ حاول مرة أخرى');
      }
      return result;
    };

    const review = async () => {
      if (!canReview) return;
      setLoading(true);
      setError('');
      try {
        const result = await request('preview');
        setPreview(result.preview as Preview);
        setPreviewSignature(signature);
      } catch (err: unknown) {
        setPreview(null);
        setError(err instanceof Error ? err.message : 'تعذر حساب أثر الاتفاقية');
      } finally {
        setLoading(false);
      }
    };

    const approve = async () => {
      if (!canApprove || !currentPreview) return;
      if (!requestKey.current) requestKey.current = crypto.randomUUID();
      setApplying(true);
      setError('');
      try {
        const result = await request('apply');
        onApplied(
          'تم اعتماد الاتفاقية وتسوية ' + result.supersededDailyRows +
          ' يومية وإثبات المرتب في الدفتر. رقم المراجعة: ' + result.revisionId,
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'تعذر اعتماد الاتفاقية');
      } finally {
        setApplying(false);
      }
    };

    useImperativeHandle(ref, () => ({
      submit: () => canApprove ? approve() : review(),
    }));

    return (
      <section className="space-y-3 rounded-xl border border-border bg-surface-muted/15 p-3 sm:p-4" aria-label="التسوية المالية بأثر رجعي">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">مراجعة الأثر المالي</h3>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          هنحسب فرق الأجر من تاريخ الاتفاقية، ونراجع اليوميات المتأثرة قبل أي تعديل.
          الحضور والمدفوعات والسلف وحركات الخزنة هتفضل محفوظة.
        </p>
        {!schemaReady && (
          <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
            التسوية بأثر رجعي غير جاهزة على قاعدة البيانات بعد. لن يتم تنفيذ أي تعديل مالي لحين تجهيز Payroll V2.
          </p>
        )}
        {schemaReady && !rolloutEnabled && (
          <p role="status" className="rounded-lg border border-border bg-surface-muted/40 p-3 text-xs leading-relaxed">
            معاينة الأثر المالي متاحة، لكن اعتماد التسوية لم يُفعَّل لهذا الموظف بعد. لازم المسؤول يفعّل الإتاحة من الخادم.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="retro-payroll-reason">سبب تعديل اتفاقية القبض *</Label>
          <Input
            id="retro-payroll-reason"
            value={reason}
            maxLength={500}
            disabled={applying}
            onChange={(event) => setReason(event.target.value)}
            placeholder="مثال: تعديل اتفاق الراتب بداية من أول أكتوبر"
            aria-describedby="retro-payroll-reason-hint"
          />
          <p id="retro-payroll-reason-hint" className="text-xs text-muted-foreground">
            {reason.trim().length < 8
              ? 'اكتب سببًا واضحًا من 8 حروف على الأقل لتفعيل معاينة الأثر المالي.'
              : 'السبب هيتحفظ مع رقم المراجعة في سجل الاتفاقيات.'}
          </p>
        </div>
        {currentPreview && (
          <div className="space-y-3 rounded-lg border border-border bg-background/70 p-3" aria-live="polite">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {blocked
                ? <AlertTriangle className="h-4 w-4 text-destructive" />
                : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              {blocked ? 'تحتاج التسوية إلى مراجعة' : 'معاينة الأثر المالي جاهزة'}
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">اليوميات المتأثرة</dt>
                <dd className="font-medium tabular-nums">{currentPreview.dailyCount} يومية</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">الأجر القديم المسجل في الدفتر</dt>
                <dd className="font-medium tabular-nums">{amount(currentPreview.previousLedgerCredits)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">الراتب الجديد ({currentPreview.proratedDays} من {currentPreview.daysInMonth} يوم)</dt>
                <dd className="font-medium tabular-nums">{amount(currentPreview.proposedMonthlyAmount)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                <dt className="font-medium">فرق الاستحقاق</dt>
                <dd className="font-semibold tabular-nums">{amount(currentPreview.difference)}</dd>
              </div>
            </dl>
            {currentPreview.branchImpacts?.length > 0 && (
              <div className="space-y-2 border-t border-border pt-3">
                <h4 className="text-xs font-semibold">التسوية حسب كل فرع</h4>
                {currentPreview.branchImpacts.map((impact) => {
                  const branch = branches.find((b) => b.branchId === impact.branchId);
                  return (
                    <div key={impact.branchId} className="space-y-2 rounded-lg border border-border bg-surface-muted/20 p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <strong>{branch?.branchName ?? 'فرع #' + impact.branchId}</strong>
                        <span className="tabular-nums font-semibold">{amount(impact.monthlySalary)} / شهر</span>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2 text-muted-foreground">
                        <span>أجر قديم: {amount(impact.oldLedgerCredits)} ({impact.dailyCount} يومية)</span>
                        <span>استحقاق جديد: {amount(impact.newEntitlement)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2">
                        <span>فرق استحقاق الفرع</span>
                        <strong className="tabular-nums">{amount(impact.difference)}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              المدفوع: {amount(currentPreview.paidOut)}، السلف: {amount(currentPreview.advances)}،
              الخصومات: {amount(currentPreview.deductions)} — لن يتم تعديل هذه الحركات.
              فرق الاستحقاق المعروض ليس مبلغًا جاهزًا للصرف، ولا ينشئ صرفًا من الخزنة.
            </p>
            {!blocked && rolloutEnabled && (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs leading-relaxed">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span>راجعت مبالغ الفروع واليوميات وفرق الاستحقاق. أوافق على إلغاء أثر الأجور القديمة وإثبات الاستحقاق الشهري، بدون تغيير السلف أو الخزنة.</span>
              </label>
            )}
            {blocked && (
              <div role="alert" className="space-y-2">
                {currentPreview.blockers.map((message, index) => (
                  <p key={index} className="flex gap-2 text-xs text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" />{message}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          التنفيذ يتم فقط بعد المعاينة والاعتماد من زر أسفل النافذة.
          تعديل باقي بيانات الموظف مش داخل في التسوية المالية دي.
        </p>
      </section>
    );
  },
);

export default RetroPayrollAgreementReview;
