'use client';

import { useState } from 'react';
import { Trash2, ShoppingCart, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CartItem, Barber } from '@/lib/types';
import { computeServiceLineTotals } from '@/lib/sales/service-line-totals';

interface CartPanelProps {
  items: CartItem[];
  barbers: Barber[];
  onRemove: (id: string) => void;
  onUpdateItem: (id: string, patch: Partial<CartItem>) => void;
}

export default function CartPanel({ items, barbers, onRemove, onUpdateItem }: CartPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickedBarber, setPickedBarber] = useState<Barber | null>(null);
  const [discountMode, setDiscountMode] = useState<'value' | 'percent'>('value');
  const [discountDraft, setDiscountDraft] = useState('');

  function openEdit(item: CartItem) {
    setEditingId(item.id);
    setPickedBarber(barbers.find((b) => b.EmpID === item.EmpID) ?? null);
    setDiscountMode(item.Dis > 0 && item.DisVal === 0 ? 'percent' : 'value');
    setDiscountDraft(
      item.DisVal > 0 ? String(item.DisVal) : item.Dis > 0 ? String(item.Dis) : '',
    );
  }

  function applyLineDiscount(item: CartItem) {
    const raw = parseFloat(discountDraft) || 0;
    const totals = computeServiceLineTotals({
      sPrice: item.SPrice,
      qty: item.Qty,
      discountPercent: discountMode === 'percent' ? raw : undefined,
      discountValue: discountMode === 'value' ? raw : undefined,
    });
    onUpdateItem(item.id, {
      Dis: totals.discountPercent,
      DisVal: totals.discountValue,
      SPriceAfterDis: totals.netAmount,
    });
  }

  function confirmEdit(item: CartItem) {
    applyLineDiscount(item);
    if (pickedBarber) {
      onUpdateItem(item.id, { EmpID: pickedBarber.EmpID, EmpName: pickedBarber.EmpName });
    }
    setEditingId(null);
    setPickedBarber(null);
    setDiscountDraft('');
  }

  function cancelEdit() {
    setEditingId(null);
    setPickedBarber(null);
    setDiscountDraft('');
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <ShoppingCart className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-sm">لا توجد خدمات مضافة</p>
        <p className="text-xs mt-1">اختر حلاق ثم اضغط على خدمة لإضافتها</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-muted-foreground">
          الخدمات المختارة ({items.length})
        </h3>
      </div>
      <ScrollArea className="max-h-[320px]">
        <div className="space-y-1.5">
          {items.map((item, idx) => {
            const isEditing = editingId === item.id;
            const draftRaw = isEditing ? parseFloat(discountDraft) || 0 : null;
            const line = computeServiceLineTotals({
              sPrice: item.SPrice,
              qty: item.Qty,
              discountPercent:
                isEditing && discountMode === 'percent'
                  ? draftRaw!
                  : item.Dis,
              discountValue:
                isEditing && discountMode === 'value'
                  ? draftRaw!
                  : isEditing
                    ? undefined
                    : item.DisVal,
            });
            return (
              <div key={item.id} className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between p-2.5 group">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{item.ProName}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.EmpName}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5" dir="ltr">
                        {line.grossAmount.toFixed(2)}
                        {line.discountValue > 0
                          ? ` − ${line.discountValue.toFixed(2)} = ${line.netAmount.toFixed(2)}`
                          : ''}{' '}
                        ج.م
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold whitespace-nowrap">
                      {line.netAmount.toFixed(2)} ج.م
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                      onClick={() => (editingId === item.id ? cancelEdit() : openEdit(item))}
                      title="تعديل الحلاق / الخصم"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive transition-opacity"
                      onClick={() => onRemove(item.id)}
                      title="حذف"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {editingId === item.id && (
                  <div className="border-t border-border bg-muted/30 p-2.5 space-y-2">
                    <p className="text-xs text-muted-foreground font-medium">اختر الحلاق:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {barbers.map((b) => (
                        <button
                          key={b.EmpID}
                          onClick={() => setPickedBarber(b)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                            pickedBarber?.EmpID === b.EmpID
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border hover:bg-accent'
                          }`}
                        >
                          {b.EmpName}
                        </button>
                      ))}
                    </div>

                    <p className="text-xs text-muted-foreground font-medium pt-1">خصم الخدمة:</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDiscountMode('value')}
                        className={`px-2 py-1 rounded text-[11px] border ${
                          discountMode === 'value'
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border'
                        }`}
                      >
                        قيمة
                      </button>
                      <button
                        type="button"
                        onClick={() => setDiscountMode('percent')}
                        className={`px-2 py-1 rounded text-[11px] border ${
                          discountMode === 'percent'
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border'
                        }`}
                      >
                        نسبة %
                      </button>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={discountDraft}
                        onChange={(e) => setDiscountDraft(e.target.value)}
                        className="h-7 text-xs w-24 text-center"
                        dir="ltr"
                        placeholder={discountMode === 'percent' ? '%' : 'ج.م'}
                      />
                    </div>
                    <div className="text-[11px] text-muted-foreground space-y-0.5">
                      <div>السعر: {line.grossAmount.toFixed(2)} ج.م</div>
                      <div>الخصم: {line.discountValue.toFixed(2)} ج.م</div>
                      <div className="font-medium text-foreground">
                        الصافي: {line.netAmount.toFixed(2)} ج.م
                      </div>
                    </div>

                    <div className="flex gap-2 justify-end pt-1">
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={cancelEdit}>
                        <X className="w-3 h-3" /> إلغاء
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => confirmEdit(item)}
                        disabled={!pickedBarber}
                      >
                        <Check className="w-3 h-3" /> تأكيد
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
