'use client';

import { useState } from 'react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Coins, Calendar, CreditCard, FileText } from 'lucide-react';

export default function NewRevenuePage() {
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    // TODO: Implement save logic
    setTimeout(() => setSaving(false), 1000);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="إيراد جديد"
        description="إضافة إيراد أو دخل جديد غير مرتبط بفاتورة بيع مباشرة"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard
          title="إجمالي الإيرادات اليوم"
          value="٠ ر.س"
          icon={<Coins className="w-5 h-5" />}
          variant="primary"
        />
        <KpiCard
          title="عدد العمليات"
          value="٠"
          icon={<FileText className="w-5 h-5" />}
        />
        <KpiCard
          title="متوسط القيمة"
          value="٠ ر.س"
          icon={<CreditCard className="w-5 h-5" />}
        />
        <KpiCard
          title="آخر تحديث"
          value={new Date().toLocaleDateString('ar-SA')}
          icon={<Calendar className="w-5 h-5" />}
        />
      </div>

      {/* Form */}
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="date">التاريخ</Label>
            <Input
              id="date"
              type="date"
              defaultValue={new Date().toISOString().split('T')[0]}
              className="bg-zinc-950 border-zinc-800"
            />
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">القيمة (ر.س)</Label>
            <Input
              id="amount"
              type="number"
              placeholder="٠"
              className="bg-zinc-950 border-zinc-800"
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="category">التصنيف</Label>
            <Input
              id="category"
              type="text"
              placeholder="اختر التصنيف"
              list="categories"
              className="bg-zinc-950 border-zinc-800"
            />
            <datalist id="categories">
              <option value="إيجار معدات" />
              <option value="عمولة" />
              <option value="إيراد آخر" />
            </datalist>
          </div>

          {/* Payment Method */}
          <div className="space-y-2">
            <Label htmlFor="payment">طريقة الدفع</Label>
            <Input
              id="payment"
              type="text"
              placeholder="اختر طريقة الدفع"
              list="payment-methods"
              className="bg-zinc-950 border-zinc-800"
            />
            <datalist id="payment-methods">
              <option value="نقدي" />
              <option value="فيزا" />
              <option value="إنستاباي" />
            </datalist>
          </div>

          {/* Notes */}
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notes">البيان / الملاحظات</Label>
            <Input
              id="notes"
              type="text"
              placeholder="أدخل وصف الإيراد..."
              className="bg-zinc-950 border-zinc-800"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 mt-6 pt-6 border-t border-zinc-800/50">
          <Button variant="outline" className="border-zinc-700">
            إلغاء
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-amber-600 hover:bg-amber-700 gap-2"
          >
            <Plus className="w-4 h-4" />
            {saving ? 'جاري الحفظ...' : 'حفظ الإيراد'}
          </Button>
        </div>
      </div>
    </div>
  );
}
