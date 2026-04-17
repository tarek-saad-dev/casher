'use client';

import { Trash2, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CartItem } from '@/lib/types';

interface CartPanelProps {
  items: CartItem[];
  onRemove: (id: string) => void;
}

export default function CartPanel({ items, onRemove }: CartPanelProps) {
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
      <ScrollArea className="max-h-[280px]">
        <div className="space-y-1.5">
          {items.map((item, idx) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-bold shrink-0">
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{item.ProName}</p>
                  <p className="text-xs text-muted-foreground truncate">{item.EmpName}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold whitespace-nowrap">{item.SPrice} ج.م</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive transition-opacity"
                  onClick={() => onRemove(item.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
