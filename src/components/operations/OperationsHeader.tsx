'use client';

import { RefreshCw, Users, Clock, CalendarCheck, AlertTriangle, Scissors, TrendingUp } from 'lucide-react';
import type { OverviewData } from '@/lib/operationsTypes';

interface Props {
  data:         OverviewData | null;
  loading:      boolean;
  alertsCount:  number;
  onRefresh:    () => void;
  onNewQueue:   () => void;
  onNewBooking: () => void;
}

export function OperationsHeader({ data, loading, alertsCount, onRefresh, onNewQueue, onNewBooking }: Props) {
  const today = data?.date
    ? new Date(data.date + 'T00:00:00').toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const kpis = [
    {
      icon:  <Users size={16}/>,
      label: 'حلاقون متاحون',
      value: data ? `${data.availableBarbersCount} / ${data.barbers.length}` : '—',
      color: '#10B981',
    },
    {
      icon:  <Clock size={16}/>,
      label: 'في الانتظار',
      value: data?.waitingQueueCount ?? '—',
      color: '#F59E0B',
    },
    {
      icon:  <CalendarCheck size={16}/>,
      label: 'حجوزات قادمة',
      value: data?.upcomingBookingsCount ?? '—',
      color: '#6366F1',
    },
    {
      icon:  <TrendingUp size={16}/>,
      label: 'متوسط الانتظار',
      value: data ? `${data.averageWaitMinutes} د` : '—',
      color: '#06B6D4',
    },
    {
      icon:  <AlertTriangle size={16}/>,
      label: 'تنبيهات',
      value: alertsCount,
      color: alertsCount > 0 ? '#EF4444' : '#6B7280',
    },
  ];

  return (
    <div className="flex-shrink-0 border-b px-5 py-3 space-y-3" style={{ borderColor: '#2A2A35', background: '#111114' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-black text-white flex items-center gap-2">
            <Scissors size={18} style={{ color: '#D6A84F' }}/>
            لوحة التشغيل
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">{today} — وردية {data?.shift ?? '...'}</p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onRefresh} disabled={loading}
            className="p-2 rounded-xl border text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all disabled:opacity-50"
            style={{ borderColor: '#2A2A35' }}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>
          </button>

          <button onClick={onNewBooking}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all hover:opacity-80"
            style={{ borderColor: 'rgba(99,102,241,0.5)', color: '#818CF8', background: 'rgba(99,102,241,0.08)' }}>
            <CalendarCheck size={13}/>
            + حجز موعد
          </button>

          <button onClick={onNewQueue}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#D6A84F,#B8923A)', color: '#000' }}>
            <Clock size={13}/>
            + حجز دور
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-5 gap-2">
        {kpis.map(kpi => (
          <div key={kpi.label}
            className="rounded-xl border px-3 py-2.5 flex items-center gap-2"
            style={{ borderColor: '#2A2A35', background: '#1A1A20' }}>
            <span style={{ color: kpi.color }}>{kpi.icon}</span>
            <div className="min-w-0">
              <div className="text-xs text-zinc-500 truncate">{kpi.label}</div>
              <div className="text-base font-bold text-white leading-tight">{String(kpi.value)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
