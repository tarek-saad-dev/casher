'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X, Check, Loader2 } from 'lucide-react';
import SmartExpenseCategoryPicker from './SmartExpenseCategoryPicker';

interface ExpenseCategory {
  ExpINID: number;
  CatName: string;
  UsageCount: number;
  CategoryGroup: string;
}

interface EditExpenseCategoryDialogProps {
  expenseId: number;
  currentCategory: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditExpenseCategoryDialog({
  expenseId,
  currentCategory,
  onClose,
  onSuccess,
}: EditExpenseCategoryDialogProps) {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedCategoryName, setSelectedCategoryName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load categories on mount
  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/expenses/categories');
      if (!response.ok) {
        throw new Error('فشل تحميل الفئات');
      }
      const data: ExpenseCategory[] = await response.json();
      setCategories(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCategorySelect = (categoryId: number, categoryName: string) => {
    setSelectedCategoryId(categoryId);
    setSelectedCategoryName(categoryName);
    setError(null);
  };

  const handleSave = async () => {
    if (!selectedCategoryId) {
      setError('يجب اختيار فئة جديدة');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/expenses/${expenseId}/category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ExpINID: selectedCategoryId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'فشل تحديث التصنيف');
      }

      onSuccess();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg shadow-lg max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold">تعديل تصنيف المصروف</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            disabled={saving}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-2">
              التصنيف الحالي:
            </label>
            <div className="px-3 py-2 bg-amber-500/10 border border-amber-500/50 rounded-md text-amber-700 font-medium">
              {currentCategory}
            </div>
          </div>

          {selectedCategoryName && (
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-2">
                التصنيف الجديد:
              </label>
              <div className="px-3 py-2 bg-green-500/10 border border-green-500/50 rounded-md text-green-700 font-medium">
                {selectedCategoryName}
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium block mb-3">
              اختر التصنيف الصحيح:
            </label>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <SmartExpenseCategoryPicker
                categories={categories}
                onSelect={handleCategorySelect}
                currentCategory={currentCategory}
              />
            )}
          </div>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button
            onClick={handleSave}
            disabled={!selectedCategoryId || saving}
            className="gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري الحفظ...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                حفظ التصنيف
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
