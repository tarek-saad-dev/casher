'use client';

import { useState, useEffect } from 'react';
import { Lock, Save, X, AlertTriangle, CheckCircle } from 'lucide-react';
import type { PaymentMethodBreakdown, ReconciliationInput, VarianceStatus } from '@/lib/types/treasury';

interface TreasuryClosePanelProps {
  paymentMethods: PaymentMethodBreakdown[];
  newDay: number;
  shiftMoveId?: number;
  onClose: () => void;
  onSaved: () => void;
}

export default function TreasuryClosePanel({ 
  paymentMethods, 
  newDay,
  shiftMoveId,
  onClose,
  onSaved
}: TreasuryClosePanelProps) {
  const [countedAmounts, setCountedAmounts] = useState<{ [key: number]: string }>({});
  const [notes, setNotes] = useState<{ [key: number]: string }>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variances, setVariances] = useState<{ [key: number]: number }>({});

  useEffect(() => {
    // Initialize with system amounts
    const initial: { [key: number]: string } = {};
    paymentMethods.forEach(pm => {
      initial[pm.paymentMethodId] = pm.net.toFixed(2);
    });
    setCountedAmounts(initial);
  }, [paymentMethods]);

  useEffect(() => {
    // Calculate variances
    const newVariances: { [key: number]: number } = {};
    paymentMethods.forEach(pm => {
      const counted = parseFloat(countedAmounts[pm.paymentMethodId] || '0');
      newVariances[pm.paymentMethodId] = counted - pm.net;
    });
    setVariances(newVariances);
  }, [countedAmounts, paymentMethods]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ج.م';
  };

  const getVarianceStatus = (variance: number, systemAmount: number): VarianceStatus => {
    const absVariance = Math.abs(variance);
    const percentage = systemAmount !== 0 ? (absVariance / Math.abs(systemAmount)) * 100 : 0;
    
    if (absVariance <= 50) return 'acceptable';
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
    } else if (status === 'warning') {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full text-xs font-medium">
          <AlertTriangle className="h-3 w-3" />
          فرق بسيط
        </div>
      );
    } else {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full text-xs font-medium">
          <AlertTriangle className="h-3 w-3" />
          فرق كبير
        </div>
      );
    }
  };

  const handleCountedAmountChange = (paymentMethodId: number, value: string) => {
    setCountedAmounts(prev => ({
      ...prev,
      [paymentMethodId]: value
    }));
  };

  const handleNotesChange = (paymentMethodId: number, value: string) => {
    setNotes(prev => ({
      ...prev,
      [paymentMethodId]: value
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const reconciliations: ReconciliationInput[] = paymentMethods.map(pm => ({
        paymentMethodId: pm.paymentMethodId,
        systemAmount: pm.net,
        countedAmount: parseFloat(countedAmounts[pm.paymentMethodId] || '0'),
        notes: notes[pm.paymentMethodId] || undefined
      }));

      const response = await fetch('/api/treasury/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newDay,
          shiftMoveId,
          reconciliations
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'فشل حفظ القفل');
      }

      const result = await response.json();
      
      // Show success and close
      onSaved();
      onClose();
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  const totalSystemAmount = paymentMethods.reduce((sum, pm) => sum + pm.net, 0);
  const totalCountedAmount = paymentMethods.reduce((sum, pm) => 
    sum + parseFloat(countedAmounts[pm.paymentMethodId] || '0'), 0
  );
  const totalVariance = totalCountedAmount - totalSystemAmount;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gradient-to-br from-zinc-900/95 to-zinc-900/90 border border-zinc-800/50 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-xl">
              <Lock className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">قفل اليوم</h2>
              <p className="text-sm text-zinc-400">أدخل المبالغ الفعلية المعدودة</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zinc-800/40 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-zinc-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {error && (
            <div className="mb-4 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {paymentMethods.map((pm) => {
              const variance = variances[pm.paymentMethodId] || 0;
              
              return (
                <div
                  key={pm.paymentMethodId}
                  className="bg-zinc-800/40 border border-zinc-700/30 rounded-xl p-4"
                >
                  {/* Payment Method Header */}
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">{pm.paymentMethodName}</h3>
                    {getVarianceBadge(variance, pm.net)}
                  </div>

                  {/* Amounts Grid */}
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    {/* System Amount */}
                    <div>
                      <label className="block text-xs text-zinc-400 font-medium mb-2">
                        المبلغ المتوقع (النظام)
                      </label>
                      <div className="bg-zinc-900/50 border border-zinc-700/30 rounded-lg px-3 py-2">
                        <span className="text-sm font-bold text-white">
                          {formatCurrency(pm.net)}
                        </span>
                      </div>
                    </div>

                    {/* Counted Amount */}
                    <div>
                      <label className="block text-xs text-zinc-400 font-medium mb-2">
                        العد الفعلي
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={countedAmounts[pm.paymentMethodId] || ''}
                        onChange={(e) => handleCountedAmountChange(pm.paymentMethodId, e.target.value)}
                        className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                      />
                    </div>

                    {/* Variance */}
                    <div>
                      <label className="block text-xs text-zinc-400 font-medium mb-2">
                        الفرق
                      </label>
                      <div className={`border rounded-lg px-3 py-2 ${
                        Math.abs(variance) <= 50
                          ? 'bg-emerald-500/5 border-emerald-500/10'
                          : 'bg-rose-500/5 border-rose-500/10'
                      }`}>
                        <span className={`text-sm font-bold ${
                          Math.abs(variance) <= 50 ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-xs text-zinc-400 font-medium mb-2">
                      ملاحظات (اختياري)
                    </label>
                    <input
                      type="text"
                      placeholder="أضف ملاحظة إذا كان هناك فرق..."
                      value={notes[pm.paymentMethodId] || ''}
                      onChange={(e) => handleNotesChange(pm.paymentMethodId, e.target.value)}
                      className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 transition-colors"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total Summary */}
          <div className="mt-6 bg-zinc-800/60 border border-zinc-700/30 rounded-xl p-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <span className="text-xs text-zinc-400 block mb-1">إجمالي النظام</span>
                <span className="text-lg font-bold text-white">{formatCurrency(totalSystemAmount)}</span>
              </div>
              <div>
                <span className="text-xs text-zinc-400 block mb-1">إجمالي العد</span>
                <span className="text-lg font-bold text-white">{formatCurrency(totalCountedAmount)}</span>
              </div>
              <div>
                <span className="text-xs text-zinc-400 block mb-1">الفرق الكلي</span>
                <span className={`text-lg font-bold ${
                  Math.abs(totalVariance) <= 50 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {totalVariance >= 0 ? '+' : ''}{formatCurrency(totalVariance)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-zinc-800/50">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 bg-zinc-800/40 text-zinc-400 border border-zinc-700/30 rounded-xl text-sm font-medium hover:bg-zinc-800/60 transition-colors disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl text-sm font-medium hover:bg-amber-500/30 transition-colors disabled:opacity-50"
          >
            {saving ? (
              <>
                <div className="h-4 w-4 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
                جاري الحفظ...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                حفظ القفل
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
