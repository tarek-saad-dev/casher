'use client';

import { AlertTriangle, Info, Bell, X, Volume2, Eye, Edit, Plus } from 'lucide-react';
import type { OperationAlert } from '@/lib/operationsTypes';

interface Props {
  alerts:    OperationAlert[];
  loading:   boolean;
  onDismiss: (id: string) => void;
  onAction:  (alert: OperationAlert) => void;
}

const SEVERITY_STYLES = {
  info:    { icon: <Info size={13}/>,          color: '#06B6D4', bg: 'rgba(6,182,212,0.08)',   border: 'rgba(6,182,212,0.2)'  },
  warning: { icon: <AlertTriangle size={13}/>, color: '#F59E0B', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)' },
  danger:  { icon: <AlertTriangle size={13}/>, color: '#EF4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.2)'  },
} as const;

const ACTION_ICONS: Record<string, React.ReactNode> = {
  view:         <Eye size={11}/>,
  call:         <Volume2 size={11}/>,
  edit:         <Edit size={11}/>,
  add_to_queue: <Plus size={11}/>,
};

export function AlertsPanel({ alerts, loading, onDismiss, onAction }: Props) {
  const sorted = [...alerts].sort((a, b) => {
    const rank = { danger: 0, warning: 1, info: 2 };
    return (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2);
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0" style={{ borderColor: '#2A2A35' }}>
        <Bell size={14} className="text-red-400"/>
        <span className="text-sm font-bold text-white">التنبيهات</span>
        {alerts.length > 0 && (
          <span className="mr-auto text-xs px-2 py-0.5 rounded-full font-bold"
            style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>
            {alerts.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-6 text-zinc-600 text-sm">جاري التحميل...</div>
        )}
        {!loading && sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-zinc-700">
            <Bell size={22} className="mb-2 opacity-30"/>
            <p className="text-xs">لا توجد تنبيهات</p>
          </div>
        )}
        {sorted.map(alert => {
          const sty = SEVERITY_STYLES[alert.severity];
          return (
            <div key={alert.id}
              className="rounded-xl border px-3 py-2.5 space-y-2"
              style={{ background: sty.bg, borderColor: sty.border }}>

              {/* Row 1: icon + message + dismiss */}
              <div className="flex items-start gap-2">
                <span style={{ color: sty.color, flexShrink: 0, marginTop: 1 }}>{sty.icon}</span>
                <p className="flex-1 text-xs text-white leading-relaxed">{alert.message}</p>
                <button onClick={() => onDismiss(alert.id)}
                  className="p-0.5 rounded text-zinc-600 hover:text-zinc-400 transition-colors flex-shrink-0">
                  <X size={11}/>
                </button>
              </div>

              {/* Action button */}
              {alert.action && alert.actionLabel && (
                <button onClick={() => onAction(alert)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
                  style={{ background: sty.color + '22', color: sty.color, border: `1px solid ${sty.color}33` }}>
                  {ACTION_ICONS[alert.action] ?? <Eye size={11}/>}
                  {alert.actionLabel}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
