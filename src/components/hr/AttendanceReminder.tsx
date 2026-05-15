'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Clock, Users, ArrowLeft, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface PendingEmployee {
  EmpID: number;
  EmpName: string;
  ScheduledStartTime: string | null;
  Status: string;
  HasRecord: boolean;
}

interface AttendanceRow {
  EmpID: number;
  EmpName: string;
  WorkDate: string;
  IsWorkingDay: boolean;
  ScheduledStartTime: string | null;
  Status: string;
  HasRecord: boolean;
}

export default function AttendanceReminder() {
  const [pendingEmps, setPendingEmps] = useState<PendingEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  // Get current time in HH:mm format
  const getCurrentTime = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  };

  // Get today's date (business date - before 5 AM counts as yesterday)
  const getBusinessDate = () => {
    const now = new Date();
    const currentHour = now.getHours();
    if (currentHour < 5) {
      now.setDate(now.getDate() - 1);
    }
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };

  // Parse time string to minutes
  const timeToMinutes = (timeStr: string | null): number | null => {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  };

  const fetchAttendance = useCallback(async () => {
    try {
      const today = getBusinessDate();
      const res = await fetch(`/api/admin/attendance?date=${today}`);
      
      // Check if response is OK
      if (!res.ok) {
        console.warn(`[AttendanceReminder] API returned ${res.status} - ignoring`);
        setPendingEmps([]);
        return;
      }
      
      // Check content-type to avoid parsing HTML as JSON
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn('[AttendanceReminder] API returned non-JSON response - ignoring');
        setPendingEmps([]);
        return;
      }
      
      const data = await res.json();
      
      // Check for API success and attendance data
      if (!data.success || !Array.isArray(data.attendance)) {
        // Silent fail - don't break the UI
        setPendingEmps([]);
        return;
      }
      
      const currentTime = getCurrentTime();
      const currentMinutes = timeToMinutes(currentTime);

      // Filter employees who:
      // 1. Are on working day (not vacation)
      // 2. Have a scheduled time that has passed
      // 3. Haven't checked in yet (Status is Pending or no record)
      const lateEmps = data.attendance.filter((row: AttendanceRow) => {
        // Must be a working day
        if (!row.IsWorkingDay) return false;
        
        // Must have a scheduled start time
        if (!row.ScheduledStartTime) return false;
        
        // Scheduled time must have passed
        const schedMinutes = timeToMinutes(row.ScheduledStartTime);
        if (schedMinutes === null) return false;
        if (currentMinutes === null) return false;
        if (schedMinutes > currentMinutes) return false; // Time hasn't passed yet
        
        // Must not have checked in yet
        if (row.Status !== 'Pending' && row.HasRecord) return false;
        
        return true;
      }).map((row: AttendanceRow) => ({
        EmpID: row.EmpID,
        EmpName: row.EmpName,
        ScheduledStartTime: row.ScheduledStartTime,
        Status: row.Status,
        HasRecord: row.HasRecord,
      }));

      setPendingEmps(lateEmps);
    } catch (err) {
      // Silent fail - don't break the UI, just log warning
      console.warn('[AttendanceReminder] Failed to fetch attendance:', err);
      setPendingEmps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAttendance();
    // Refresh every 5 minutes
    const interval = setInterval(fetchAttendance, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAttendance]);

  if (loading || dismissed || pendingEmps.length === 0) {
    return null;
  }

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-4" dir="rtl">
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-semibold text-amber-400">
              هل وصل ...؟
            </span>
            <span className="text-xs text-zinc-400">
              ({pendingEmps.length} موظف)
            </span>
          </div>
          
          <p className="text-sm text-zinc-300 mb-3">
            فيه موظفين ميعادهم عدى ولسه متسجلش حضورهم
          </p>
          
          <div className="flex flex-wrap gap-2 mb-3">
            {pendingEmps.slice(0, 5).map((emp) => (
              <div 
                key={emp.EmpID}
                className="flex items-center gap-1.5 bg-zinc-800/60 border border-zinc-700 rounded-lg px-2 py-1"
              >
                <Users className="w-3 h-3 text-zinc-500" />
                <span className="text-xs text-zinc-300">{emp.EmpName}</span>
                {emp.ScheduledStartTime && (
                  <span className="text-[10px] text-amber-400 flex items-center gap-0.5">
                    <Clock className="w-3 h-3" />
                    {emp.ScheduledStartTime}
                  </span>
                )}
              </div>
            ))}
            {pendingEmps.length > 5 && (
              <span className="text-xs text-zinc-500 py-1">
                +{pendingEmps.length - 5} آخرين
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Link href="/admin/hr" className="flex-1">
              <Button 
                variant="outline" 
                size="sm"
                className="w-full border-amber-500/30 text-amber-400 hover:bg-amber-500/10 gap-1"
              >
                <ArrowLeft className="w-4 h-4" />
                متابعة الحضور
              </Button>
            </Link>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setDismissed(true)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
