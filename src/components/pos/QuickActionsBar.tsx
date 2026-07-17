'use client';

import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  CircleMinus,
  CirclePlus,
  HandCoins,
  History,
  MessageCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type QuickActionId =
  | 'payment-transfer'
  | 'quick-expense'
  | 'quick-income'
  | 'tips'
  | 'recent-invoices'
  | 'quick-whatsapp';

interface QuickActionConfig {
  id: QuickActionId;
  label: string;
  icon: LucideIcon;
  title?: string;
}

const QUICK_ACTIONS: QuickActionConfig[] = [
  {
    id: 'payment-transfer',
    label: 'تحويل بين طرق الدفع',
    icon: ArrowLeftRight,
    title: 'تحويل مبالغ بين طرق الدفع',
  },
  {
    id: 'quick-expense',
    label: 'إضافة مصروف فوري',
    icon: CircleMinus,
    title: 'تسجيل مصروف سريع',
  },
  {
    id: 'quick-income',
    label: 'إضافة إيراد فوري',
    icon: CirclePlus,
    title: 'تسجيل إيراد سريع',
  },
  {
    id: 'tips',
    label: 'تبس',
    icon: HandCoins,
    title: 'تسجيل تبس من فرق الدفع للحلاق',
  },
  {
    id: 'recent-invoices',
    label: 'آخر الفواتير',
    icon: History,
    title: 'عرض آخر الفواتير',
  },
  {
    id: 'quick-whatsapp',
    label: 'رسالة واتساب سريعة',
    icon: MessageCircle,
    title: 'إرسال رسالة ترحيب على واتساب',
  },
];

interface QuickActionsBarProps {
  onAction: (actionId: QuickActionId) => void;
  className?: string;
}

export default function QuickActionsBar({ onAction, className }: QuickActionsBarProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface/80 p-2 backdrop-blur-sm',
        className,
      )}
      dir="rtl"
    >
      <div className="scrollbar-none flex items-stretch gap-2 overflow-x-auto pb-0.5">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              title={action.title ?? action.label}
              aria-label={action.label}
              onClick={() => onAction(action.id)}
              className={cn(
                'flex h-10 min-w-[max(9.5rem,42%)] shrink-0 items-center justify-center gap-2',
                'rounded-lg border border-border bg-surface px-3',
                'text-xs font-medium text-foreground transition-colors',
                'hover:border-primary/40 hover:bg-primary/10 hover:text-primary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                'sm:min-w-[10.5rem] sm:text-sm',
              )}
            >
              <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span className="whitespace-nowrap">{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
