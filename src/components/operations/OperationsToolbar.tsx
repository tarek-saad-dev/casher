'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Filter, Calendar, Zap, Plus, AlertTriangle } from 'lucide-react';

interface Props {
  date: string;
  dateLabel: string;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  onRefresh: () => void;
  onCreateQueue: () => void;
  onFindNearestQueue?: () => void;
  onSettleExpired?: () => void;
  settlingExpired?: boolean;
  loading?: boolean;
  onDateSelect?: (date: string) => void; // YYYY-MM-DD
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
  onSettleExpired,
  settlingExpired,
  loading,
  onDateSelect,
}: Props) {
  const [showCalendar, setShowCalendar] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);

  // Close calendar when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setShowCalendar(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle date selection from calendar
  const handleDateSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedDate = e.target.value;
    if (selectedDate && onDateSelect) {
      onDateSelect(selectedDate);
    }
    setShowCalendar(false);
  };
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
        {/* Previous Day - Arrow pointing left (towards past) */}
        <button
          onClick={onPrevDay}
          className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
          style={{ color: '#d4af37' }}
          title="اليوم السابق"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="relative" ref={calendarRef}>
          <button
            onClick={() => setShowCalendar(!showCalendar)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border hover:bg-zinc-800 transition-colors"
            style={{ borderColor: 'rgba(212, 175, 55, 0.2)', background: '#111' }}
            title="اختر تاريخ"
          >
            <Calendar className="w-4 h-4" style={{ color: '#d4af37' }} />
            <span className="text-white font-medium">{dateLabel}</span>
          </button>

          {/* Calendar Dropdown */}
          {showCalendar && (
            <div 
              className="absolute top-full left-1/2 -translate-x-1/2 mt-2 p-3 rounded-xl border z-50"
              style={{ 
                borderColor: 'rgba(212, 175, 55, 0.3)', 
                background: '#1a1a1a',
                boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
              }}
            >
              <input
                type="date"
                value={date}
                onChange={handleDateSelect}
                className="px-3 py-2 rounded-lg text-white text-center"
                style={{ 
                  background: '#111', 
                  border: '1px solid rgba(212, 175, 55, 0.3)',
                  colorScheme: 'dark'
                }}
                autoFocus
              />
              <div className="mt-2 text-center">
                <button
                  onClick={() => { onToday(); setShowCalendar(false); }}
                  className="text-xs px-3 py-1 rounded-lg"
                  style={{ 
                    background: 'rgba(212, 175, 55, 0.15)', 
                    color: '#d4af37',
                    border: '1px solid rgba(212, 175, 55, 0.3)'
                  }}
                >
                  الذهاب لليوم
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Next Day - Arrow pointing right (towards future) */}
        <button
          onClick={onNextDay}
          className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
          style={{ color: '#d4af37' }}
          title="اليوم التالي"
        >
          <ChevronRight className="w-5 h-5" />
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

        {onSettleExpired && (
          <button
            onClick={onSettleExpired}
            disabled={loading || settlingExpired}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)', color: '#fff' }}
            title="تسوية الأدوار المنتهية"
          >
            {settlingExpired ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            <span>تسوية المنتهية</span>
          </button>
        )}

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
