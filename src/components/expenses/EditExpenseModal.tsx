'use client';

import { useState, useEffect } from 'react';
import { X, Save, Loader2, History, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ExpenseCategory, PaymentMethod } from '@/lib/types';

interface EditExpenseModalProps {
  expense: {
    ID: number;
    ExpINID: number;
    CatName: string;
    GrandTolal: number;
    PaymentMethodID: number;
    PaymentMethod: string | null;
    Notes: string | null;
    invDate: string;
    EditHistory?: any[];
  };
  categories: ExpenseCategory[];
  paymentMethods: PaymentMethod[];
  onClose: () => void;
  onSaved: () => void;
}

export default function EditExpenseModal({
  expense,
  categories,
  paymentMethods,
  onClose,
  onSaved
}: EditExpenseModalProps) {
  const [selectedCatId, setSelectedCatId] = useState(expense.ExpINID);
  const [amount, setAmount] = useState(expense.GrandTolal.toString());
  const [paymentMethodId, setPaymentMethodId] = useState(expense.PaymentMethodID);
  const [notes, setNotes] = useState(expense.Notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const handleSave = async () => {
    if (!selectedCatId || !amount || !paymentMethodId) {
      setError('يجب إدخال جميع البيانات المطلوبة');
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('المبلغ غير صالح');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const response = await fetch(`/api/expenses/${expense.ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expINID: selectedCatId,
          grandTotal: amountNum,
          paymentMethodId,
          notes
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'فشل تحديث المصروف');
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold">تعديل المصروف</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-accent rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* Original Date Info */}
          <div className="mb-4 p-3 bg-muted/50 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground">
              تاريخ التسجيل الأصلي: <span className="font-bold text-foreground">{formatDate(expense.invDate)}</span>
            </p>
            <p className="text-xs text-amber-600 mt-1">
              ⓘ سيتم الاحتفاظ بتاريخ التسجيل الأصلي وإضافة تاريخ التعديل للسجل
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Category */}
            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-2">
                فئة المصروف
              </label>
              <select
                value={selectedCatId}
                onChange={(e) => setSelectedCatId(parseInt(e.target.value))}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {categories.map((cat) => (
                  <option key={cat.ExpINID} value={cat.ExpINID}>
                    {cat.CatName}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-2">
                المبلغ (ج.م)
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-lg font-bold text-center h-12"
                dir="ltr"
              />
            </div>

            {/* Payment Method */}
            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-2">
                طريقة الدفع
              </label>
              <div className="grid grid-cols-2 gap-2">
                {paymentMethods.map((pm) => {
                  const isSelected = paymentMethodId === pm.ID;
                  return (
                    <button
                      key={pm.ID}
                      onClick={() => setPaymentMethodId(pm.ID)}
                      className={`
                        px-4 py-3 rounded-lg border transition-all text-sm font-bold
                        ${isSelected
                          ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/30'
                          : 'border-border hover:border-muted-foreground/30 hover:bg-accent'
                        }
                      `}
                    >
                      {pm.Name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-2">
                ملاحظات (اختياري)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="أضف ملاحظات..."
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Edit History */}
            {expense.EditHistory && expense.EditHistory.length > 0 && (
              <div>
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <History className="h-4 w-4" />
                  سجل التعديلات ({expense.EditHistory.length})
                </button>

                {showHistory && (
                  <div className="mt-2 space-y-2 max-h-[200px] overflow-y-auto">
                    {expense.EditHistory.map((edit: any, index: number) => (
                      <div
                        key={index}
                        className="p-3 bg-muted/30 rounded-lg border border-border text-xs"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-foreground">{edit.editedBy}</span>
                          <span className="text-muted-foreground">{formatDate(edit.editedAt)}</span>
                        </div>
                        {edit.changes && (
                          <div className="text-muted-foreground space-y-0.5">
                            {edit.changes.grandTotal && (
                              <div>المبلغ: {edit.changes.grandTotal.old} ← {edit.changes.grandTotal.new}</div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-border">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
          >
            إلغاء
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري الحفظ...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                حفظ التعديلات
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
