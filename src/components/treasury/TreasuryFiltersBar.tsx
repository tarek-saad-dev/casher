'use client';

import { useState, useEffect } from 'react';
import { Calendar, Users, Clock, RefreshCw } from 'lucide-react';
import type { DayOption, ShiftOption, UserOption } from '@/lib/types/treasury';

interface TreasuryFiltersBarProps {
  onFilterChange: (filters: {
    newDay: number | null;
    dateFrom: string | null;
    dateTo: string | null;
    shiftMoveId: number | null;
    userId: number | null;
  }) => void;
  currentDay: { newDay: number; dayDate: string } | null;
  currentShift: { shiftMoveId: number; shiftName: string } | null;
}

export default function TreasuryFiltersBar({ 
  onFilterChange, 
  currentDay, 
  currentShift 
}: TreasuryFiltersBarProps) {
  const [selectedNewDay, setSelectedNewDay] = useState<number | null>(currentDay?.newDay || null);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [selectedShiftMoveId, setSelectedShiftMoveId] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  
  const [days, setDays] = useState<DayOption[]>([]);
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  
  const [loadingDays, setLoadingDays] = useState(false);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Load days on mount
  useEffect(() => {
    loadDays();
    loadUsers();
  }, []);

  // Load shifts when day changes
  useEffect(() => {
    if (selectedNewDay !== null) {
      loadShifts(selectedNewDay);
    } else {
      setShifts([]);
      setSelectedShiftMoveId(null);
    }
  }, [selectedNewDay]);

  // Emit filter changes
  useEffect(() => {
    onFilterChange({
      newDay: selectedNewDay,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      shiftMoveId: selectedShiftMoveId,
      userId: selectedUserId
    });
  }, [selectedNewDay, dateFrom, dateTo, selectedShiftMoveId, selectedUserId]);

  const loadDays = async () => {
    setLoadingDays(true);
    try {
      const response = await fetch('/api/business-days?limit=30');
      if (response.ok) {
        const data = await response.json();
        const dayOptions: DayOption[] = data.days.map((d: any) => ({
          newDay: d.NewDay,
          dayDate: d.DayDate,
          label: `يوم ${d.NewDay} - ${new Date(d.DayDate).toLocaleDateString('ar-EG')}`,
          isOpen: d.IsOpen
        }));
        setDays(dayOptions);
      }
    } catch (error) {
      console.error('Failed to load days:', error);
    } finally {
      setLoadingDays(false);
    }
  };

  const loadShifts = async (newDay: number) => {
    setLoadingShifts(true);
    try {
      const response = await fetch(`/api/shifts?newDay=${newDay}`);
      if (response.ok) {
        const data = await response.json();
        const shiftOptions: ShiftOption[] = data.shifts.map((s: any) => ({
          shiftMoveId: s.ShiftMoveID,
          shiftName: s.ShiftName,
          userName: s.UserName,
          label: `${s.ShiftName} - ${s.UserName}`
        }));
        setShifts(shiftOptions);
      }
    } catch (error) {
      console.error('Failed to load shifts:', error);
    } finally {
      setLoadingShifts(false);
    }
  };

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await fetch('/api/users?active=true');
      if (response.ok) {
        const data = await response.json();
        const userOptions: UserOption[] = data.users.map((u: any) => ({
          userId: u.UserID,
          userName: u.UserName
        }));
        setUsers(userOptions);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleCurrentDay = () => {
    if (currentDay) {
      setSelectedNewDay(currentDay.newDay);
      setDateFrom('');
      setDateTo('');
    }
  };

  const handleCurrentShift = () => {
    if (currentShift) {
      setSelectedShiftMoveId(currentShift.shiftMoveId);
    }
  };

  const handleReset = () => {
    setSelectedNewDay(currentDay?.newDay || null);
    setDateFrom('');
    setDateTo('');
    setSelectedShiftMoveId(null);
    setSelectedUserId(null);
  };

  return (
    <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-5 shadow-xl shadow-black/10">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-amber-500/10 rounded-xl">
          <Calendar className="h-5 w-5 text-amber-400" />
        </div>
        <h3 className="text-lg font-bold text-white">فلاتر الخزنة</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Business Day Selector */}
        <div>
          <label className="block text-xs text-zinc-400 font-medium mb-2">
            اليوم
          </label>
          <select
            value={selectedNewDay || ''}
            onChange={(e) => setSelectedNewDay(e.target.value ? parseInt(e.target.value) : null)}
            disabled={loadingDays}
            className="w-full bg-zinc-800/40 border border-zinc-700/30 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors"
          >
            <option value="">اختر اليوم</option>
            {days.map((day) => (
              <option key={day.newDay} value={day.newDay}>
                {day.label} {day.isOpen && '(مفتوح)'}
              </option>
            ))}
          </select>
        </div>

        {/* Date From */}
        <div>
          <label className="block text-xs text-zinc-400 font-medium mb-2">
            من تاريخ
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full bg-zinc-800/40 border border-zinc-700/30 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors"
          />
        </div>

        {/* Date To */}
        <div>
          <label className="block text-xs text-zinc-400 font-medium mb-2">
            إلى تاريخ
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full bg-zinc-800/40 border border-zinc-700/30 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors"
          />
        </div>

        {/* Shift Selector */}
        <div>
          <label className="block text-xs text-zinc-400 font-medium mb-2">
            الوردية
          </label>
          <select
            value={selectedShiftMoveId || ''}
            onChange={(e) => setSelectedShiftMoveId(e.target.value ? parseInt(e.target.value) : null)}
            disabled={loadingShifts || !selectedNewDay}
            className="w-full bg-zinc-800/40 border border-zinc-700/30 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors disabled:opacity-50"
          >
            <option value="">كل الورديات</option>
            {shifts.map((shift) => (
              <option key={shift.shiftMoveId} value={shift.shiftMoveId}>
                {shift.label}
              </option>
            ))}
          </select>
        </div>

        {/* User Selector */}
        <div>
          <label className="block text-xs text-zinc-400 font-medium mb-2">
            المستخدم
          </label>
          <select
            value={selectedUserId || ''}
            onChange={(e) => setSelectedUserId(e.target.value ? parseInt(e.target.value) : null)}
            disabled={loadingUsers}
            className="w-full bg-zinc-800/40 border border-zinc-700/30 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors"
          >
            <option value="">كل المستخدمين</option>
            {users.map((user) => (
              <option key={user.userId} value={user.userId}>
                {user.userName}
              </option>
            ))}
          </select>
        </div>

        {/* Quick Actions */}
        <div className="md:col-span-2 lg:col-span-3 flex items-end gap-2">
          <button
            onClick={handleCurrentDay}
            disabled={!currentDay}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl text-sm font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Calendar className="h-4 w-4" />
            اليوم الحالي
          </button>
          
          <button
            onClick={handleCurrentShift}
            disabled={!currentShift}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-xl text-sm font-medium hover:bg-amber-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Clock className="h-4 w-4" />
            الوردية الحالية
          </button>
          
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800/40 text-zinc-400 border border-zinc-700/30 rounded-xl text-sm font-medium hover:bg-zinc-800/60 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            إعادة تعيين
          </button>
        </div>
      </div>
    </div>
  );
}
