'use client';

import { AlertTriangle, Info, XCircle, BellOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OperationsAlert } from '@/lib/types/operations';

interface Props {
  alerts: OperationsAlert[];
}

const ALERT_CONFIG = {
  error: {
    icon: <XCircle className="w-4 h-4 shrink-0 mt-0.5" />,
    bg: 'bg-destructive-soft border-destructive/30',
    text: 'text-destructive',
    label: 'خطأ',
    labelColor: 'bg-destructive-soft text-destructive',
  },
  warning: {
    icon: <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />,
    bg: 'bg-warning-soft border-warning/30',
    text: 'text-warning',
    label: 'تنبيه',
    labelColor: 'bg-warning-soft text-warning',
  },
  info: {
    icon: <Info className="w-4 h-4 shrink-0 mt-0.5" />,
    bg: 'bg-info-soft border-info/30',
    text: 'text-info',
    label: 'معلومة',
    labelColor: 'bg-info-soft text-info',
  },
};

export default function AlertsCard({ alerts }: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-warning-soft flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-warning" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">التنبيهات</p>
          <h3 className="text-base font-bold text-foreground mt-0.5">
            {alerts.length > 0 ? `${alerts.length} تنبيه نشط` : 'لا توجد تنبيهات'}
          </h3>
        </div>
        {alerts.length > 0 && (
          <span className="mr-auto text-xs font-semibold px-2.5 py-1 rounded-full bg-warning-soft text-warning border border-warning/30">
            {alerts.length}
          </span>
        )}
      </div>

      {alerts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-6 gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-success-soft flex items-center justify-center">
            <BellOff className="w-5 h-5 text-success" />
          </div>
          <p className="text-sm text-muted-foreground">كل شيء يعمل بشكل سليم</p>
        </div>
      ) : (
        <div className="space-y-2.5 flex-1">
          {alerts.map((alert, idx) => {
            const cfg = ALERT_CONFIG[alert.type];
            return (
              <div
                key={idx}
                className={cn('flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm', cfg.bg, cfg.text)}
              >
                {cfg.icon}
                <div className="flex-1">
                  <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded mr-0 ml-2 inline-block', cfg.labelColor)}>
                    {cfg.label}
                  </span>
                  {alert.message}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
