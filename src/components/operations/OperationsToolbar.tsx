'use client';

import { ChevronLeft, ChevronRight, RefreshCw, Filter, Calendar, Zap, Plus } from 'lucide-react';

interface Props {
  date: string;
  dateLabel: string;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  onRefresh: () => void;
  onCreateQueue: () => void;
  onFindNearestQueue?: () => void;
  loading?: boolean;
}

export function OperationsToolbar({
  date,
  dateLabel,
  onPrevDay,
  onNextDay,
  onToday,
  onRefresh,
  onCreateQueue,
  onFindNearestQueue,
  loading,
}: Props) {
  return (
    <div
      className="flex items-center justify-between px-6 py-4 border-b"
      style={{ background: '#0a0a0a', borderColor: 'rgba(212, 175, 55, 0.15)' }}
    >
      {/* Right: Title */}
      <div className="flex flex-col">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <span style={{ color: '#d4af37' }}>◆</span>
          لوحة التشغيل
        </h1>
        <p className="text-sm text-zinc-500">جدولة الأدوار والحجوزات حسب كل حلاق</p>
      </div>

      {/* Center: Date Selector */}
      <div className="flex items-center gap-3">
        <button
          onClick={onPrevDay}
          className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
          style={{ color: '#a1a1aa' }}
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 px-4 py-2 rounded-xl border" style={{ borderColor: 'rgba(212, 175, 55, 0.2)', background: '#111' }}>
          <Calendar className="w-4 h-4" style={{ color: '#d4af37' }} />
          <span className="text-white font-medium">{dateLabel}</span>
        </div>

        <button
          onClick={onNextDay}
          className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
          style={{ color: '#a1a1aa' }}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <button
          onClick={onToday}
          className="px-3 py-1.5 text-sm rounded-lg border transition-colors"
          style={{ borderColor: 'rgba(212, 175, 55, 0.3)', color: '#d4af37' }}
        >
          اليوم
        </button>
      </div>

      {/* Left: Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-2.5 rounded-xl border hover:bg-zinc-800 transition-colors disabled:opacity-50"
          style={{ borderColor: 'rgba(212, 175, 55, 0.2)', color: '#a1a1aa' }}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>

        {onFindNearestQueue && (
          <button
            onClick={onFindNearestQueue}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all hover:brightness-110"
            style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#fff' }}
          >
            <Zap className="w-4 h-4" />
            <span>إيجاد أقرب دور</span>
          </button>
        )}

        <button
          onClick={onCreateQueue}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-base transition-all hover:brightness-110"
          style={{ background: '#d4af37', color: '#050505' }}
        >
          <Plus className="w-5 h-5" />
          <span>إنشاء دور</span>
        </button>
      </div>
    </div>
  );
}
