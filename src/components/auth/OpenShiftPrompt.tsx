'use client';

import { useState, useEffect } from 'react';
import { Clock, LogOut, Loader2, AlertCircle, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Shift {
  ShiftID: number;
  ShiftName: string;
}

interface OpenShiftPromptProps {
  userName: string;
  defaultShiftId: number | null;
  hasOpenDay: boolean;
  isAdmin: boolean;
  onOpenShift: (shiftId: number) => Promise<void>;
  onOpenDay: () => Promise<void>;
  onLogout: () => Promise<void>;
}

export default function OpenShiftPrompt({
  userName,
  defaultShiftId,
  hasOpenDay,
  isAdmin,
  onOpenShift,
  onOpenDay,
  onLogout,
}: OpenShiftPromptProps) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [selectedShift, setSelectedShift] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [error, setError] = useState('');
  const [openingDay, setOpeningDay] = useState(false);

  // Load available shifts if needed
  useEffect(() => {
    if (hasOpenDay && !defaultShiftId) {
      loadShifts();
    }
  }, [hasOpenDay, defaultShiftId]);

  // Auto-select default shift
  useEffect(() => {
    if (defaultShiftId && !selectedShift) {
      setSelectedShift(String(defaultShiftId));
    }
  }, [defaultShiftId, selectedShift]);

  async function loadShifts() {
    setLoadingShifts(true);
    try {
      const res = await fetch('/api/shift/definitions');
      if (res.ok) {
        const data = await res.json();
        setShifts(data.shifts || []);
      }
    } catch {
      // Silent fail
    } finally {
      setLoadingShifts(false);
    }
  }

  async function handleOpenShift() {
    if (!selectedShift) {
      setError('يرجى اختيار الوردية');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onOpenShift(parseInt(selectedShift));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل فتح الوردية');
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenDay() {
    setOpeningDay(true);
    setError('');
    try {
      await onOpenDay();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل فتح يوم العمل');
    } finally {
      setOpeningDay(false);
    }
  }

  // If no open day
  if (!hasOpenDay) {
    return (
      <Dialog open={true}>
        <DialogContent className="max-w-[95vw] sm:max-w-md p-4 sm:p-6" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-base sm:text-lg">
              <Store className="w-5 h-5" />
              لا يوجد يوم عمل مفتوح
            </DialogTitle>
            <DialogDescription className="text-sm sm:text-base">
              مرحبًا {userName}، لا يوجد يوم عمل مفتوح حاليًا.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 sm:space-y-4 py-3 sm:py-4">
            {isAdmin ? (
              <div className="bg-muted/50 rounded-lg p-3 sm:p-4">
                <p className="text-sm mb-3 sm:mb-4">
                  أنت المدير. هل تريد فتح يوم عمل جديد؟
                </p>
                {error && (
                  <div className="text-xs sm:text-sm text-destructive bg-destructive/10 rounded-lg p-2.5 sm:p-3 mb-3 sm:mb-4">
                    {error}
                  </div>
                )}
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <Button
                    onClick={handleOpenDay}
                    disabled={openingDay}
                    className="flex-1 h-11 sm:h-10"
                  >
                    {openingDay ? (
                      <>
                        <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                        جاري الفتح...
                      </>
                    ) : (
                      <>
                        <Store className="w-4 h-4 ml-2" />
                        فتح يوم عمل جديد
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={onLogout} className="flex-1 h-11 sm:h-10">
                    <LogOut className="w-4 h-4 ml-2" />
                    خروج
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-destructive/10 rounded-lg p-3 sm:p-4 text-center">
                <AlertCircle className="w-7 h-7 sm:w-8 sm:h-8 text-destructive mx-auto mb-2 sm:mb-3" />
                <p className="text-sm mb-3 sm:mb-4">
                  لا يوجد يوم عمل مفتوح. برجاء التواصل مع المدير لفتح يوم العمل.
                </p>
                <Button variant="outline" onClick={onLogout} className="w-full h-11 sm:h-10">
                  <LogOut className="w-4 h-4 ml-2" />
                  تسجيل الخروج
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Has open day, but no shift - show shift prompt
  return (
    <Dialog open={true}>
      <DialogContent className="max-w-[95vw] sm:max-w-md p-4 sm:p-6" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Clock className="w-5 h-5 text-primary" />
            لا توجد وردية مفتوحة
          </DialogTitle>
          <DialogDescription className="text-sm sm:text-base">
            مرحبًا {userName}، لا توجد وردية مفتوحة حاليًا لحسابك.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 sm:space-y-4 py-3 sm:py-4">
          <p className="text-sm text-muted-foreground">
            هل تريد فتح وردية الآن؟
          </p>

          {error && (
            <div className="text-xs sm:text-sm text-destructive bg-destructive/10 rounded-lg p-2.5 sm:p-3">
              {error}
            </div>
          )}

          {!defaultShiftId && shifts.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">اختيار الوردية</label>
              <Select
                value={selectedShift}
                onValueChange={setSelectedShift}
                disabled={loading || loadingShifts}
              >
                <SelectTrigger className="h-11 sm:h-10">
                  <SelectValue placeholder="اختر الوردية" />
                </SelectTrigger>
                <SelectContent>
                  {shifts.map((shift) => (
                    <SelectItem key={shift.ShiftID} value={String(shift.ShiftID)}>
                      {shift.ShiftName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {defaultShiftId && (
            <div className="bg-muted/50 rounded-lg p-2.5 sm:p-3">
              <p className="text-sm">
                سيتم فتح الوردية الافتراضية:{' '}
                <span className="font-semibold">
                  {shifts.find((s) => s.ShiftID === defaultShiftId)?.ShiftName ||
                    `وردية #${defaultShiftId}`}
                </span>
              </p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 pt-2">
            <Button
              onClick={handleOpenShift}
              disabled={loading || (!defaultShiftId && !selectedShift)}
              className="flex-1 h-11 sm:h-10"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  جاري الفتح...
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4 ml-2" />
                  فتح وردية
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={onLogout}
              disabled={loading}
              className="flex-1 h-11 sm:h-10"
            >
              <LogOut className="w-4 h-4 ml-2" />
              خروج
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
