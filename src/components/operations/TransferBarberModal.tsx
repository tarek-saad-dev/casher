'use client';

import { X, Loader2, ArrowLeftRight } from 'lucide-react';
import { useState } from 'react';
import type { QueueTicket, BarberStatus } from '@/lib/operationsTypes';

interface Props {
  ticket:  QueueTicket;
  barbers: BarberStatus[];
  onClose: () => void;
  onTransfer: (ticketId: number, newEmpId: number) => Promise<void>;
}

export function TransferBarberModal({ ticket, barbers, onClose, onTransfer }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [loading,  setLoading]  = useState(false);

  const others = barbers.filter(b => b.EmpID !== ticket.EmpID);

  const handleTransfer = async () => {
    if (!selected) return;
    setLoading(true);
    try { await onTransfer(ticket.QueueTicketID, selected); onClose(); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="relative rounded-2xl border shadow-2xl w-full max-w-sm mx-4"
        style={{ background: '#141418', borderColor: '#2A2A35' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#2A2A35' }}>
          <div className="flex items-center gap-2">
            <ArrowLeftRight size={15} className="text-violet-400"/>
            <span className="font-bold text-white text-sm">نقل {ticket.TicketCode} لحلاق آخر</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all">
            <X size={15}/>
          </button>
        </div>

        <div className="px-5 py-4 space-y-2 max-h-72 overflow-y-auto">
          {others.length === 0 && (
            <p className="text-zinc-500 text-sm text-center py-4">لا يوجد حلاقون آخرون</p>
          )}
          {others.map(b => (
            <button key={b.EmpID}
              onClick={() => setSelected(b.EmpID)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-all"
              style={{
                borderColor: selected === b.EmpID ? '#8B5CF6' : '#2A2A35',
                background:  selected === b.EmpID ? 'rgba(139,92,246,0.12)' : 'transparent',
                color: b.IsAvailable ? '#F7F1E5' : '#6B7280',
              }}>
              <span className="font-medium">{b.EmpName}</span>
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: b.IsAvailable ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.15)',
                  color: b.IsAvailable ? '#10B981' : '#6B7280',
                }}>
                {b.IsAvailable ? 'متاح' : b.AvailabilityReason}
              </span>
            </button>
          ))}
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border text-sm font-semibold text-zinc-400 hover:bg-zinc-800 transition-all"
            style={{ borderColor: '#2A2A35' }}>إلغاء</button>
          <button onClick={handleTransfer} disabled={!selected || loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg,#8B5CF6,#7C3AED)', color: '#fff' }}>
            {loading ? <Loader2 size={14} className="animate-spin"/> : <ArrowLeftRight size={14}/>}
            نقل
          </button>
        </div>
      </div>
    </div>
  );
}
