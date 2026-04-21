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
    bg: 'bg-rose-950/30 border-rose-800/30',
    text: 'text-rose-300',
    label: 'خطأ',
    labelColor: 'bg-rose-500/20 text-rose-400',
  },
  warning: {
    icon: <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />,
    bg: 'bg-amber-950/30 border-amber-800/30',
    text: 'text-amber-300',
    label: 'تنبيه',
    labelColor: 'bg-amber-500/20 text-amber-400',
  },
  info: {
    icon: <Info className="w-4 h-4 shrink-0 mt-0.5" />,
    bg: 'bg-blue-950/30 border-blue-800/30',
    text: 'text-blue-300',
    label: 'معلومة',
    labelColor: 'bg-blue-500/20 text-blue-400',
  },
};

export default function AlertsCard({ alerts }: Props) {
  return (
    <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/60 p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">التنبيهات</p>
          <h3 className="text-base font-bold text-white mt-0.5">
            {alerts.length > 0 ? `${alerts.length} تنبيه نشط` : 'لا توجد تنبيهات'}
          </h3>
        </div>
        {alerts.length > 0 && (
          <span className="mr-auto text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
            {alerts.length}
          </span>
        )}
      </div>

      {alerts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-6 gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <BellOff className="w-5 h-5 text-emerald-500" />
          </div>
          <p className="text-sm text-zinc-500">كل شيء يعمل بشكل سليم</p>
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
