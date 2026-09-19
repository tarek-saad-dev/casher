'use client';

import { useState, useEffect } from 'react';
import { Lock, X, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import type {
  DailyTreasuryData,
  PaymentMethodBreakdown,
  ReconciliationInput,
  VarianceStatus,
} from '@/lib/types/treasury';

export interface ShiftCloseReconPanelProps {
  /** Optional preloaded breakdown; panel still refreshes for the shift. */
  paymentMethods?: PaymentMethodBreakdown[];
  shiftMoveId: number;
  shiftName?: string;
  onClose: () => void;
  onClosed: () => void;
}

const VARIANCE_THRESHOLD = 50;

export default function ShiftCloseReconPanel({
  paymentMethods: initialMethods,
  shiftMoveId,
  shiftName,
  onClose,
  onClosed,
}: ShiftCloseReconPanelProps) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodBreakdown[]>(
    initialMethods?.filter((pm) => pm.paymentMethodId != null) ?? [],
  );
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [countedAmounts, setCountedAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [variances, setVariances] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingSummary(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/treasury/daily-summary?shiftMoveId=${encodeURIComponent(String(shiftMoveId))}`,
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'فشل تحميل ملخص الوردية');
        }
        const data: DailyTreasuryData = await res.json();
        if (cancelled) return;
        const methods = (data.paymentMethods || []).filter((pm) => pm.paymentMethodId != null);
        setPaymentMethods(methods);
        const initial: Record<string, string> = {};
        methods.forEach((pm) => {
          initial[pm.paymentMethodKey] = pm.net.toFixed(2);
        });
        setCountedAmounts(initial);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'فشل تحميل ملخص الوردية');
        }
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shiftMoveId]);

  useEffect(() => {
    const next: Record<string, number> = {};
    paymentMethods.forEach((pm) => {
      const counted = parseFloat(countedAmounts[pm.paymentMethodKey] || '0');
      next[pm.paymentMethodKey] = counted - pm.net;
    });
    setVariances(next);
  }, [countedAmounts, paymentMethods]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ج.م';

  const getVarianceStatus = (variance: number, systemAmount: number): VarianceStatus => {
    const absVariance = Math.abs(variance);
    const percentage = systemAmount !== 0 ? (absVariance / Math.abs(systemAmount)) * 100 : 0;
    if (absVariance <= VARIANCE_THRESHOLD) return 'acceptable';
    if (percentage <= 5) return 'warning';
    return 'critical';
  };

  const getVarianceBadge = (variance: number, systemAmount: number) => {
    const status = getVarianceStatus(variance, systemAmount);
    if (status === 'acceptable') {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-xs font-medium">
          <CheckCircle className="h-3 w-3" />
          متطابق
        </div>
      );
    }
    if (status === 'warning') {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full text-xs font-medium">
          <AlertTriangle className="h-3 w-3" />
          فرق بسيط
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full text-xs font-medium">
        <AlertTriangle className="h-3 w-3" />
        فرق كبير
      </div>
    );
  };

  async function submitClose() {
    setSaving(true);
    setError(null);
    try {
      const reconciliations: ReconciliationInput[] = paymentMethods.map((pm) => ({
        paymentMethodId: pm.paymentMethodId,
        systemAmount: pm.net,
        countedAmount: parseFloat(countedAmounts[pm.paymentMethodKey] || '0'),
        notes: notes[pm.paymentMethodKey] || undefined,
      }));

      const response = await fetch('/api/treasury/shift-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftMoveId, reconciliations }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'فشل تقفيل الوردية');
      }

      onClosed();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  }

  const totalSystemAmount = paymentMethods.reduce((sum, pm) => sum + pm.net, 0);
  const totalCountedAmount = paymentMethods.reduce(
    (sum, pm) => sum + parseFloat(countedAmounts[pm.paymentMethodKey] || '0'),
    0,
  );
  const totalVariance = totalCountedAmount - totalSystemAmount;
  const busy = saving || loadingSummary;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gradient-to-br from-zinc-900/95 to-zinc-900/90 border border-zinc-800/50 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-zinc-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-xl">
              <Lock className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">تقفيل الوردية</h2>
              <p className="text-sm text-zinc-400">
                راجع المبالغ ثم اقفل الوردية
                {shiftName ? ` — ${shiftName}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-2 hover:bg-zinc-800/40 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5 text-zinc-400" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-220px)]">
          {error && (
            <div className="mb-4 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
              {error}
            </div>
          )}

          {loadingSummary ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-zinc-400">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500/60" />
              جاري تحميل ملخص الوردية...
            </div>
          ) : paymentMethods.length === 0 ? (
            <div className="p-4 bg-zinc-800/40 border border-zinc-700/30 rounded-xl text-zinc-300 text-sm">
              لا توجد حركات مالية في هذه الوردية. يمكنك تقفيلها مباشرة.
            </div>
          ) : (
            <div className="space-y-4">
              {paymentMethods.map((pm) => {
                const variance = variances[pm.paymentMethodKey] || 0;
                return (
                  <div
                    key={pm.paymentMethodKey}
                    className="bg-zinc-800/40 border border-zinc-700/30 rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-white">{pm.paymentMethodName}</h3>
                      {getVarianceBadge(variance, pm.net)}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                      <div>
                        <label className="block text-xs text-zinc-400 font-medium mb-2">
                          المبلغ المتوقع (النظام)
                        </label>
                        <div className="bg-zinc-900/50 border border-zinc-700/30 rounded-lg px-3 py-2">
                          <span className="text-sm font-bold text-white">{formatCurrency(pm.net)}</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-400 font-medium mb-2">
                          العد الفعلي
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={countedAmounts[pm.paymentMethodKey] || ''}
                          onChange={(e) =>
                            setCountedAmounts((prev) => ({
                              ...prev,
                              [pm.paymentMethodKey]: e.target.value,
                            }))
                          }
                          disabled={busy}
                          className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors disabled:opacity-50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-400 font-medium mb-2">الفرق</label>
                        <div
                          className={`border rounded-lg px-3 py-2 ${
                            Math.abs(variance) <= VARIANCE_THRESHOLD
                              ? 'bg-emerald-500/5 border-emerald-500/10'
                              : 'bg-rose-500/5 border-rose-500/10'
                          }`}
                        >
                          <span
                            className={`text-sm font-bold ${
                              Math.abs(variance) <= VARIANCE_THRESHOLD
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {variance >= 0 ? '+' : ''}
                            {formatCurrency(variance)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400 font-medium mb-2">
                        ملاحظات (اختياري)
                      </label>
                      <input
                        type="text"
                        placeholder="أضف ملاحظة إذا كان هناك فرق..."
                        value={notes[pm.paymentMethodKey] || ''}
                        onChange={(e) =>
                          setNotes((prev) => ({
                            ...prev,
                            [pm.paymentMethodKey]: e.target.value,
                          }))
                        }
                        disabled={busy}
                        className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 transition-colors disabled:opacity-50"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loadingSummary && paymentMethods.length > 0 && (
            <div className="mt-6 bg-zinc-800/60 border border-zinc-700/30 rounded-xl p-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <span className="text-xs text-zinc-400 block mb-1">إجمالي النظام</span>
                  <span className="text-lg font-bold text-white">
                    {formatCurrency(totalSystemAmount)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-zinc-400 block mb-1">إجمالي العد</span>
                  <span className="text-lg font-bold text-white">
                    {formatCurrency(totalCountedAmount)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-zinc-400 block mb-1">الفرق الكلي</span>
                  <span
                    className={`text-lg font-bold ${
                      Math.abs(totalVariance) <= VARIANCE_THRESHOLD
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {totalVariance >= 0 ? '+' : ''}
                    {formatCurrency(totalVariance)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-zinc-500">
            يمكنك تقفيل الوردية حتى لو كان هناك فرق — الملاحظة اختيارية.
          </p>
        </div>

        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 p-6 border-t border-zinc-800/50">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 bg-zinc-800/40 text-zinc-400 border border-zinc-700/30 rounded-xl text-sm font-medium hover:bg-zinc-800/60 transition-colors disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={() => void submitClose()}
            disabled={busy}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800/60 text-zinc-200 border border-zinc-600/40 rounded-xl text-sm font-medium hover:bg-zinc-700/60 transition-colors disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري التقفيل...
              </>
            ) : (
              'قفل الوردية على أي حال'
            )}
          </button>
          <button
            type="button"
            onClick={() => void submitClose()}
            disabled={busy}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl text-sm font-medium hover:bg-amber-500/30 transition-colors disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري التقفيل...
              </>
            ) : (
              <>
                <Lock className="h-4 w-4" />
                قفل الوردية
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
