'use client';

import { AlertTriangle, Clock, User, Scissors, ArrowRight, X, UserCheck, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AlternativeBarber {
  empId: number;
  empName: string;
  available: boolean;
  estimatedStartTime: string;
  reason?: string;
}

interface ConflictBooking {
  bookingId: number;
  clientName: string | null;
  startTime: string;
  endTime: string;
  status: string;
}

interface QueueConflictDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPlaceAfterBooking: () => void;
  onSelectAlternativeBarber: (empId: number) => void;
  onForceManualPriority: () => void;
  onCancel: () => void;
  conflictBooking: ConflictBooking | null;
  availableGapMinutes: number | null;
  requiredDurationMinutes: number;
  suggestedStartAfterBooking: string | null;
  alternativeBarbers: AlternativeBarber[];
  message: string;
}

export function QueueConflictDialog({
  isOpen,
  onClose,
  onPlaceAfterBooking,
  onSelectAlternativeBarber,
  onForceManualPriority,
  onCancel,
  conflictBooking,
  availableGapMinutes,
  requiredDurationMinutes,
  suggestedStartAfterBooking,
  alternativeBarbers,
  message,
}: QueueConflictDialogProps) {
  if (!isOpen) return null;

  const formatTime = (timeStr: string) => {
    try {
      const d = new Date(timeStr);
      const h = d.getHours() % 12 || 12;
      const m = String(d.getMinutes()).padStart(2, '0');
      const period = d.getHours() < 12 ? 'ص' : 'م';
      return `${h}:${m} ${period}`;
    } catch {
      return timeStr;
    }
  };

  const availableAlternatives = alternativeBarbers.filter(b => b.available);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-w-md w-full p-5">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-lg bg-amber-500/20">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-1">تعارض مع حجز قادم</h3>
            <p className="text-sm text-zinc-400">{message}</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Conflict Details */}
        {conflictBooking && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 mb-4">
            <div className="flex items-center gap-2 text-sm text-zinc-300 mb-2">
              <User className="h-4 w-4 text-indigo-400" />
              <span className="font-medium">{conflictBooking.clientName || 'عميل غير محدد'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Clock className="h-4 w-4 text-zinc-500" />
              <span>الحجز من {formatTime(conflictBooking.startTime)} إلى {formatTime(conflictBooking.endTime)}</span>
            </div>
          </div>
        )}

        {/* Gap Info */}
        <div className="flex items-center gap-3 mb-4 text-sm">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Clock className="h-4 w-4" />
            <span>الوقت المتاح: <span className="text-amber-400 font-medium">{availableGapMinutes} دقيقة</span></span>
          </div>
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Scissors className="h-4 w-4" />
            <span>المدة المطلوبة: <span className="text-rose-400 font-medium">{requiredDurationMinutes} دقيقة</span></span>
          </div>
        </div>

        {/* Alternative Barbers */}
        {availableAlternatives.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-medium text-zinc-500 mb-2">حلاقين بدلاء متاحين:</p>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {availableAlternatives.slice(0, 3).map((barber) => (
                <button
                  key={barber.empId}
                  onClick={() => onSelectAlternativeBarber(barber.empId)}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg border border-zinc-700 bg-zinc-800/30 hover:bg-zinc-800 hover:border-zinc-600 transition-all text-left"
                >
                  <div className="flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm text-zinc-200">{barber.empName}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-zinc-500">يبدأ {formatTime(barber.estimatedStartTime)}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-zinc-500" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          {suggestedStartAfterBooking && (
            <Button
              onClick={onPlaceAfterBooking}
              variant="outline"
              className="w-full justify-between border-zinc-700 hover:bg-zinc-800 text-zinc-200"
            >
              <span>ضع الدور بعد الحجز</span>
              <span className="text-xs text-zinc-500">يبدأ {formatTime(suggestedStartAfterBooking)}</span>
            </Button>
          )}

          <Button
            onClick={onForceManualPriority}
            variant="outline"
            className="w-full justify-center border-amber-700/50 hover:bg-amber-950/30 text-amber-400"
          >
            <AlertCircle className="h-4 w-4 ml-2" />
            إدخال يدوي بأولوية (يتجاوز التعارض)
          </Button>

          <Button
            onClick={onCancel}
            variant="ghost"
            className="w-full justify-center text-zinc-500 hover:text-zinc-300"
          >
            إلغاء
          </Button>
        </div>
      </div>
    </div>
  );
}
