'use client';

import { Users, Clock, Calendar, Scissors } from 'lucide-react';
import type { BarberStatus } from '@/lib/operationsTypes';

interface Props {
  barbers: BarberStatus[];
  loading: boolean;
}

function statusBadge(b: BarberStatus) {
  if (b.currentTicket) return { label: 'مشغول', color: '#F59E0B' };
  if (!b.IsAvailable)  return { label: b.AvailabilityReason, color: '#EF4444' };
  if (b.nextBooking)   return { label: 'لديه حجز قريب', color: '#6366F1' };
  return { label: 'متاح', color: '#10B981' };
}

export function BarberStatusColumn({ barbers, loading }: Props) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: '#2A2A35' }}>
        <Users size={14} className="text-emerald-400"/>
        <span className="text-sm font-bold text-white">الحلاقون</span>
        <span className="mr-auto text-xs text-zinc-500">{barbers.filter(b => b.IsAvailable && !b.currentTicket).length} متاح</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-8 text-zinc-600 text-sm">جاري التحميل...</div>
        )}
        {!loading && barbers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-zinc-600">
            <Scissors size={24} className="mb-2 opacity-30"/>
            <p className="text-sm">لا يوجد حلاقون</p>
          </div>
        )}
        {barbers.map(b => {
          const badge = statusBadge(b);
          return (
            <div key={b.EmpID}
              className="rounded-xl border p-3 space-y-2 transition-all"
              style={{ borderColor: '#2A2A35', background: '#1A1A20' }}>

              {/* Name + badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: 'rgba(214,168,79,0.15)', color: '#D6A84F', border: '1px solid rgba(214,168,79,0.3)' }}>
                    {b.EmpName.slice(0, 2)}
                  </div>
                  <span className="text-sm font-bold text-white">{b.EmpName}</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: badge.color + '22', color: badge.color, border: `1px solid ${badge.color}44` }}>
                  {badge.label}
                </span>
              </div>

              {/* Current customer */}
              {b.currentTicket && (
                <div className="px-2.5 py-1.5 rounded-lg text-xs" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <span className="text-amber-400 font-bold">{b.currentTicket.TicketCode}</span>
                  {b.currentTicket.ClientName && (
                    <span className="text-zinc-400 mr-2">{b.currentTicket.ClientName}</span>
                  )}
                </div>
              )}

              {/* Next queue ticket */}
              {b.nextTicket && (
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Clock size={10}/>
                  التالي: <span className="text-white font-medium">{b.nextTicket.TicketCode}</span>
                  {b.nextTicket.ClientName && <span className="text-zinc-500">— {b.nextTicket.ClientName}</span>}
                </div>
              )}

              {/* Next booking */}
              {b.nextBooking && (
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Calendar size={10}/>
                  حجز: <span className="text-indigo-400 font-medium">{String(b.nextBooking.StartTime ?? '').slice(0,5)}</span>
                  {b.nextBooking.ClientName && <span className="text-zinc-500">— {b.nextBooking.ClientName}</span>}
                </div>
              )}

              {/* Working hours */}
              {b.WorkingStartTime && b.WorkingEndTime && (
                <div className="flex items-center gap-1.5 text-xs text-zinc-600">
                  <Clock size={9}/>
                  {b.WorkingStartTime} — {b.WorkingEndTime}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
