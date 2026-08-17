'use client';

import { useState } from 'react';
import { X, Save, Loader2, History, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { notifyEmployeeLedgerRefresh } from '@/lib/cashMoveDeleteClient';

interface EmployeeOption {
  EmpID: number;
  EmpName: string;
  Job: string;
  AdvanceExpINID: number;
  AdvanceCatName: string;
}

interface PaymentMethodOption {
  ID: number;
  Name: string;
}

interface EditDeductionModalProps {
  deduction: {
    ID: number;
    invID: number;
    ExpINID: number;
    EmpID: number;
    EmpName: string;
    CatName: string;
    GrandTolal: number;
    PaymentMethodID: number;
    PaymentMethod: string | null;
    Notes: string | null;
    invDate: string;
    EditHistory?: unknown;
  };
  employees: EmployeeOption[];
  paymentMethods: PaymentMethodOption[];
  onClose: () => void;
  onSaved: () => void;
}

function parseEditHistory(raw: unknown): Array<{
  editedAt: string;
  editedBy: string;
  changes?: { grandTotal?: { old: number; new: number } };
}> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as ReturnType<typeof parseEditHistory>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function EditDeductionModal({
  deduction,
  employees,
  paymentMethods,
  onClose,
  onSaved,
}: EditDeductionModalProps) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(deduction.EmpID || 0);
  const [amount, setAmount] = useState(String(deduction.GrandTolal ?? ''));
  const [paymentMethodId, setPaymentMethodId] = useState(deduction.PaymentMethodID);
  const [notes, setNotes] = useState(deduction.Notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const editHistory = parseEditHistory(deduction.EditHistory);

  const handleSave = async () => {
    if (!selectedEmployeeId || !amount || !paymentMethodId) {
      setError('يجب إدخال جميع البيانات المطلوبة');
      return;
    }

    const employee = employees.find((e) => e.EmpID === selectedEmployeeId);
    if (!employee?.AdvanceExpINID) {
      setError('لم يتم العثور على تصنيف سلف للموظف');
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
      const response = await fetch(`/api/expenses/${deduction.ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expINID: employee.AdvanceExpINID,
          grandTotal: amountNum,
          paymentMethodId,
          notes,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || 'فشل تحديث الخصم');
        return;
      }

      notifyEmployeeLedgerRefresh();
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
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden" dir="rtl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold">تعديل الخصم #{deduction.invID}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-accent rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="mb-4 p-3 bg-muted/50 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground">
              تاريخ التسجيل الأصلي:{' '}
              <span className="font-bold text-foreground">{formatDate(deduction.invDate)}</span>
            </p>
            <p className="text-xs text-amber-600 mt-1">
              ⓘ سيتم الاحتفاظ بتاريخ التسجيل الأصلي وإضافة تاريخ التعديل للسجل
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-2">
                الموظف
              </label>
              <select
                value={selectedEmployeeId || ''}
                onChange={(e) => setSelectedEmployeeId(parseInt(e.target.value) || 0)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">— اختر الموظف —</option>
                {employees.map((emp) => (
                  <option key={emp.EmpID} value={emp.EmpID}>
                    {emp.EmpName} {emp.Job ? `(${emp.Job})` : ''}
                  </option>
                ))}
              </select>
            </div>

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
                      type="button"
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

            {editHistory.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <History className="h-4 w-4" />
                  سجل التعديلات ({editHistory.length})
                </button>

                {showHistory && (
                  <div className="mt-2 space-y-2 max-h-[200px] overflow-y-auto">
                    {editHistory.map((edit, index) => (
                      <div
                        key={index}
                        className="p-3 bg-muted/30 rounded-lg border border-border text-xs"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-foreground">{edit.editedBy}</span>
                          <span className="text-muted-foreground">{formatDate(edit.editedAt)}</span>
                        </div>
                        {edit.changes?.grandTotal && (
                          <div className="text-muted-foreground">
                            المبلغ: {edit.changes.grandTotal.old} ← {edit.changes.grandTotal.new}
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

        <div className="flex items-center justify-end gap-3 p-4 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
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
