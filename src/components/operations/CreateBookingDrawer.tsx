'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, Search, User, Scissors, Loader2, CheckCircle2,
  Calendar, Clock, AlertTriangle, ChevronRight, ChevronLeft,
} from 'lucide-react';

interface Service {
  ProID: number;
  ProName: string;
  SPrice: number;
  DurationMinutes: number | null;
}

interface Client {
  ClientID: number;
  Name: string;
  Mobile?: string;
}

interface AvailableSlot {
  time: string;
  label: string;
  empId: number;
  barberName: string;
  durationMinutes: number;
  durationSource: string;
}

interface Barber {
  empId: number;
  empName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialDate?: string;
  initialTime?: string;
  initialEmpId?: number;
  initialBarberName?: string;
  initialTimeRangeStart?: string;  // e.g., "15:00" for 3:00 PM
  initialTimeRangeEnd?: string;    // e.g., "16:00" for 4:00 PM
  barbers: Barber[];
  onCreated?: () => void;
}

type Mode = 'nearest' | 'specific';

// Get Cairo today date string
function getCairoToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

// Format date for display
function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const dayName = days[date.getDay()];
  const dayNum = date.getDate();
  const monthName = months[date.getMonth()];
  return `${dayName} ${dayNum} ${monthName}`;
}

// Format time for display (14:00 -> 02:00 م)
function formatTimeDisplay(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'م' : 'ص';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Convert time string to minutes for comparison
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// Check if slot fits within time range (considering duration)
function isSlotInsideRange(
  slot: AvailableSlot,
  rangeStart: string,
  rangeEnd: string,
  serviceDurationMinutes: number
): boolean {
  const slotStart = timeToMinutes(slot.time);
  const duration = slot.durationMinutes ?? serviceDurationMinutes ?? 30;
  const slotEnd = slotStart + duration;
  const rangeStartMin = timeToMinutes(rangeStart);
  const rangeEndMin = timeToMinutes(rangeEnd);

  return slotStart >= rangeStartMin && slotEnd <= rangeEndMin;
}

export function CreateBookingDrawer({
  open,
  onClose,
  initialDate,
  initialTime,
  initialEmpId,
  initialBarberName,
  initialTimeRangeStart,
  initialTimeRangeEnd,
  barbers,
  onCreated,
}: Props) {
  // Initialize with prefilled data from calendar cell or defaults
  const [step, setStep] = useState<number>(1);
  const [mode, setMode] = useState<Mode>(initialEmpId ? 'specific' : 'nearest');
  
  // Customer info
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showClients, setShowClients] = useState(false);
  
  // Service selection
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  
  // Date and time
  const [bookingDate, setBookingDate] = useState(initialDate || getCairoToday());
  const [bookingTime, setBookingTime] = useState(initialTime || '14:00');
  
  // Barber selection
  const [selectedBarberId, setSelectedBarberId] = useState<number | null>(initialEmpId || null);
  
  // Available slots from API
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  
  // Time range filtering (for calendar cell clicks)
  const [showAllSlots, setShowAllSlots] = useState(false);
  const hasTimeRange = !!initialTimeRangeStart && !!initialTimeRangeEnd;
  
  // Reset showAllSlots when drawer opens with new initial data
  useEffect(() => {
    if (open) {
      setShowAllSlots(false);
    }
  }, [open, initialTimeRangeStart, initialTimeRangeEnd]);
  
  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load services on mount
  useEffect(() => {
    fetch('/api/services?active=true')
      .then(r => r.json())
      .then(d => setServices(d.services ?? d ?? []))
      .catch(() => { });
  }, []);

  // Client search
  useEffect(() => {
    if (clientSearch.length < 2) { setClients([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/customers?q=${encodeURIComponent(clientSearch)}`)
        .then(r => r.json())
        .then(d => {
          const list: Client[] = Array.isArray(d) ? d : (d.clients ?? d.data ?? []);
          setClients(list);
          setShowClients(true);
        })
        .catch(() => { });
    }, 300);
    return () => clearTimeout(t);
  }, [clientSearch]);

  // Fetch available slots from API
  const fetchAvailableSlots = useCallback(async () => {
    if (!selectedService || !bookingDate) return;
    
    // Validation: specific mode requires empId
    if (mode === 'specific' && !selectedBarberId) {
      setError('اختر الحلاق أولًا');
      setLoadingSlots(false);
      return;
    }
    
    setLoadingSlots(true);
    setAvailableSlots([]);
    setError(null);
    
    try {
      let url: string;
      if (mode === 'specific' && selectedBarberId) {
        url = `/api/public/booking/available-slots?date=${bookingDate}&serviceIds=${selectedService.ProID}&mode=specific&empId=${selectedBarberId}&source=operations`;
        console.log('[CreateBookingDrawer] fetching specific slots for empId:', selectedBarberId);
      } else {
        url = `/api/public/booking/available-slots?date=${bookingDate}&serviceIds=${selectedService.ProID}&mode=nearest&source=operations`;
      }
      
      console.log('[CreateBookingDrawer] fetching slots:', url);
      
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.ok && data.slots) {
        setAvailableSlots(data.slots);
        console.log('[CreateBookingDrawer] slots loaded:', data.slots.length);
      } else {
        setAvailableSlots([]);
      }
    } catch (err) {
      console.error('[CreateBookingDrawer] slots error:', err);
      setAvailableSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [bookingDate, selectedService, mode, selectedBarberId]);

  // Fetch slots when relevant data changes
  useEffect(() => {
    if (step === 2 && selectedService) {
      fetchAvailableSlots();
    }
  }, [step, selectedService, fetchAvailableSlots]);

  // Filter slots by time range (only for calendar cell clicks)
  const filteredSlots = useMemo(() => {
    if (!hasTimeRange || showAllSlots) {
      return availableSlots;
    }
    
    const serviceDuration = selectedService?.DurationMinutes ?? 30;
    return availableSlots.filter(slot =>
      isSlotInsideRange(slot, initialTimeRangeStart!, initialTimeRangeEnd!, serviceDuration)
    );
  }, [availableSlots, hasTimeRange, showAllSlots, initialTimeRangeStart, initialTimeRangeEnd, selectedService]);

  // Get selected slot details
  const selectedSlot = availableSlots.find(s => s.time === bookingTime);

  // Check if current time is available
  const isTimeAvailable = selectedSlot !== undefined;

  // Calculate end time
  const endTime = (() => {
    if (!selectedService) return null;
    const duration = selectedService.DurationMinutes || 30;
    const [h, m] = bookingTime.split(':').map(Number);
    const end = new Date(0, 0, 0, h, m + duration);
    return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  })();

  // Validation
  const canProceed = {
    1: !!selectedService,
    2: isTimeAvailable && !!selectedSlot,
    3: !!(customerName || selectedClient),
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!selectedSlot || !selectedService) return;
    
    // Validation: specific mode requires empId
    if (mode === 'specific' && !selectedBarberId) {
      setError('اختر الحلاق أولًا');
      return;
    }
    
    setError(null);
    setSubmitting(true);
    
    try {
      // When mode='specific', use the selectedBarberId (from initial or user selection)
      // When mode='nearest', use the slot's empId (which could be any available barber)
      const finalEmpId = mode === 'specific' ? selectedBarberId : selectedSlot.empId;
      
      if (!finalEmpId) {
        setError('معرف الحلاق غير متوفر');
        return;
      }
      
      const payload = {
        customer: {
          name: selectedClient?.Name || customerName,
          phone: selectedClient?.Mobile || customerPhone,
        },
        serviceIds: [selectedService.ProID],
        date: bookingDate,
        time: bookingTime,
        mode: mode,
        empId: finalEmpId,
        notes: '',
        source: 'operations',
      };
      
      console.log('[CreateBookingDrawer] creating booking with empId:', finalEmpId, 'mode:', mode);
      
      console.log('[CreateBookingDrawer] creating booking:', payload);
      
      const res = await fetch('/api/public/booking/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      const data = await res.json();
      
      if (res.status === 409) {
        setError('المعاد لم يعد متاحًا، من فضلك اختر ميعادًا آخر.');
        return;
      }
      
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'فشل إنشاء الحجز');
      }
      
      setSuccess(true);
      
      setTimeout(() => {
        onCreated?.();
        onClose();
        // Reset state
        setStep(1);
        setSuccess(false);
        setSelectedService(null);
        setCustomerName('');
        setCustomerPhone('');
        setSelectedClient(null);
      }, 1500);
    } catch (err: any) {
      console.error('[CreateBookingDrawer] submit error:', err);
      setError(err?.message || 'فشل إنشاء الحجز');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  if (success) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-sm" dir="rtl">
        <div className="rounded-2xl border p-8 text-center space-y-3" style={{ background: '#141418', borderColor: '#2A2A35' }}>
          <CheckCircle2 size={40} className="text-emerald-400 mx-auto" />
          <p className="font-bold text-white text-lg">تم إنشاء الحجز</p>
          <p className="text-sm text-zinc-500">{formatDateLabel(bookingDate)} — {formatTimeDisplay(bookingTime)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-end bg-black/60 backdrop-blur-sm" onClick={onClose} dir="rtl">
      <div
        className="h-full w-full max-w-md flex flex-col shadow-2xl overflow-hidden"
        style={{ background: '#141418', borderLeft: '1px solid #2A2A35' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: '#2A2A35' }}>
          <h2 className="font-bold text-white text-base">إنشاء حجز جديد</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all">
            <X size={15} />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-4 px-5 py-3 border-b" style={{ borderColor: '#2A2A35' }}>
          {[
            { num: 1, label: 'الخدمة' },
            { num: 2, label: 'الموعد' },
            { num: 3, label: 'العميل' },
          ].map((s, idx) => (
            <div key={s.num} className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  background: step >= s.num ? '#D4AF37' : '#2A2A35',
                  color: step >= s.num ? '#000' : '#6B7280',
                }}
              >
                {s.num}
              </div>
              <span className="text-xs" style={{ color: step >= s.num ? '#D4AF37' : '#6B7280' }}>{s.label}</span>
              {idx < 2 && <ChevronLeft size={12} className="text-zinc-600 mr-1" />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          
          {/* Prefilled Summary (if from calendar cell) */}
          {(initialBarberName || initialTime) && (
            <div className="p-3 rounded-xl border" style={{ borderColor: 'rgba(212,175,55,0.3)', background: 'rgba(212,175,55,0.05)' }}>
              <p className="text-xs text-zinc-400 mb-2">معلومات الموعد المختار:</p>
              <div className="space-y-1">
                {initialBarberName && (
                  <p className="text-sm text-white">الحلاق: <span className="text-amber-400">{initialBarberName}</span></p>
                )}
                <p className="text-sm text-white">التاريخ: <span className="text-amber-400">{formatDateLabel(bookingDate)}</span></p>
                {hasTimeRange ? (
                  <p className="text-sm text-white">
                    الفترة: <span className="text-amber-400">{formatTimeDisplay(initialTimeRangeStart!)} - {formatTimeDisplay(initialTimeRangeEnd!)}</span>
                  </p>
                ) : initialTime && (
                  <p className="text-sm text-white">الوقت: <span className="text-amber-400">{formatTimeDisplay(initialTime)}</span></p>
                )}
              </div>
            </div>
          )}

          {/* Step 1: Service Selection */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-zinc-400 mb-3">اختر الخدمة</p>
                <div className="space-y-2">
                  {services.length === 0 && (
                    <div className="text-center py-4">
                      <Loader2 size={20} className="animate-spin mx-auto text-zinc-500 mb-2" />
                      <p className="text-xs text-zinc-500">جاري تحميل الخدمات...</p>
                    </div>
                  )}
                  {services.map((svc: Service) => {
                    const isSelected = selectedService?.ProID === svc.ProID;
                    return (
                      <button
                        key={svc.ProID}
                        onClick={() => setSelectedService(svc)}
                        className="w-full text-right p-3 rounded-xl border transition-all flex items-center gap-3"
                        style={{
                          borderColor: isSelected ? '#D4AF37' : '#2A2A35',
                          background: isSelected ? 'rgba(212,175,55,0.1)' : 'transparent',
                        }}
                      >
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center"
                          style={{ background: isSelected ? 'rgba(212,175,55,0.2)' : '#1A1A20' }}
                        >
                          <Scissors size={18} style={{ color: isSelected ? '#D4AF37' : '#6B7280' }} />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold" style={{ color: isSelected ? '#D4AF37' : '#fff' }}>{svc.ProName}</p>
                          <p className="text-xs text-zinc-500">{svc.DurationMinutes || 30} دقيقة</p>
                        </div>
                        {isSelected && <CheckCircle2 size={18} className="text-amber-400" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Mode Selection */}
              <div>
                <p className="text-xs font-semibold text-zinc-400 mb-3">طريقة الاختيار</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'nearest', label: 'أقرب حلاق', desc: 'متاح' },
                    { value: 'specific', label: 'حلاق معين', desc: initialBarberName || 'اختر' },
                  ].map((m: { value: string; label: string; desc: string }) => (
                    <button
                      key={m.value}
                      onClick={() => setMode(m.value as Mode)}
                      disabled={m.value === 'specific' && !!initialEmpId}
                      className="p-3 rounded-xl border text-center transition-all disabled:opacity-50"
                      style={{
                        borderColor: mode === m.value ? '#D4AF37' : '#2A2A35',
                        background: mode === m.value ? 'rgba(212,175,55,0.1)' : 'transparent',
                      }}
                    >
                      <p className="text-sm font-semibold" style={{ color: mode === m.value ? '#D4AF37' : '#fff' }}>{m.label}</p>
                      <p className="text-xs text-zinc-500">{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Barber Selection (if specific mode) */}
              {mode === 'specific' && !initialEmpId && (
                <div>
                  <p className="text-xs font-semibold text-zinc-400 mb-3">اختر الحلاق</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {barbers.map((barber: Barber) => {
                      const isSelected = selectedBarberId === barber.empId;
                      return (
                        <button
                          key={barber.empId}
                          onClick={() => setSelectedBarberId(barber.empId)}
                          className="w-full text-right p-3 rounded-xl border transition-all flex items-center gap-3"
                          style={{
                            borderColor: isSelected ? '#D4AF37' : '#2A2A35',
                            background: isSelected ? 'rgba(212,175,55,0.1)' : 'transparent',
                          }}
                        >
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center"
                            style={{ background: isSelected ? 'rgba(212,175,55,0.2)' : '#1A1A20' }}
                          >
                            <User size={16} style={{ color: isSelected ? '#D4AF37' : '#6B7280' }} />
                          </div>
                          <p className="text-sm" style={{ color: isSelected ? '#D4AF37' : '#fff' }}>{barber.empName}</p>
                          {isSelected && <CheckCircle2 size={16} className="text-amber-400 mr-auto" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Date Selection */}
              {!initialDate && (
                <div>
                  <p className="text-xs font-semibold text-zinc-400 mb-2">التاريخ</p>
                  <input
                    type="date"
                    value={bookingDate}
                    onChange={(e) => setBookingDate(e.target.value)}
                    className="w-full rounded-xl border px-3 py-2 text-sm text-white bg-transparent outline-none"
                    style={{ borderColor: '#2A2A35', colorScheme: 'dark' }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Step 2: Time Selection */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStep(1)}
                  className="p-2 rounded-lg border text-zinc-400 hover:text-white transition-colors"
                  style={{ borderColor: '#2A2A35' }}
                >
                  <ChevronRight size={16} />
                </button>
                <p className="text-sm text-zinc-400">اختر الوقت المتاح</p>
              </div>

              {/* Service Info */}
              {selectedService && (
                <div className="p-3 rounded-xl border" style={{ borderColor: '#2A2A35', background: '#1A1A20' }}>
                  <p className="text-xs text-zinc-500">الخدمة:</p>
                  <p className="text-sm text-white font-semibold">{selectedService.ProName}</p>
                  <p className="text-xs text-zinc-500 mt-1">{selectedService.DurationMinutes || 30} دقيقة</p>
                </div>
              )}

              {/* Loading State */}
              {loadingSlots && (
                <div className="text-center py-8">
                  <Loader2 size={24} className="animate-spin mx-auto text-zinc-500 mb-3" />
                  <p className="text-sm text-zinc-500">جاري تحميل المواعيد المتاحة...</p>
                </div>
              )}

              {/* No Slots Available */}
              {!loadingSlots && availableSlots.length === 0 && (
                <div className="text-center py-8">
                  <AlertTriangle size={24} className="mx-auto text-amber-500 mb-3" />
                  <p className="text-sm text-zinc-400">لا توجد مواعيد متاحة</p>
                  <p className="text-xs text-zinc-600 mt-2">جرب تغيير التاريخ أو الخدمة</p>
                  <button
                    onClick={() => setStep(1)}
                    className="mt-4 px-4 py-2 rounded-lg border text-sm"
                    style={{ borderColor: '#D4AF37', color: '#D4AF37' }}
                  >
                    تغيير الخدمة
                  </button>
                </div>
              )}

              {/* Time Range Label (if from calendar cell) */}
              {hasTimeRange && !showAllSlots && (
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-amber-400" />
                  <p className="text-xs text-amber-400">المواعيد المتاحة داخل الفترة المختارة</p>
                </div>
              )}

              {/* Available Slots Grid - uses filteredSlots */}
              {!loadingSlots && filteredSlots.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {filteredSlots.map((slot: AvailableSlot) => {
                    const isSelected = bookingTime === slot.time;
                    return (
                      <button
                        key={slot.time}
                        onClick={() => setBookingTime(slot.time)}
                        className="p-3 rounded-xl border text-center transition-all"
                        style={{
                          borderColor: isSelected ? '#D4AF37' : '#2A2A35',
                          background: isSelected ? 'rgba(212,175,55,0.1)' : 'transparent',
                        }}
                      >
                        <p className="text-sm font-semibold" style={{ color: isSelected ? '#D4AF37' : '#fff' }}>
                          {formatTimeDisplay(slot.time)}
                        </p>
                        <p className="text-xs text-zinc-500">{slot.barberName}</p>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Empty State: No slots in range */}
              {!loadingSlots && hasTimeRange && filteredSlots.length === 0 && availableSlots.length > 0 && !showAllSlots && (
                <div className="text-center py-6">
                  <AlertTriangle size={24} className="mx-auto text-amber-500 mb-3" />
                  <p className="text-sm text-zinc-400">لا توجد مواعيد متاحة داخل هذه الفترة</p>
                  <button
                    onClick={() => setShowAllSlots(true)}
                    className="mt-3 px-4 py-2 rounded-lg border text-sm"
                    style={{ borderColor: '#D4AF37', color: '#D4AF37' }}
                  >
                    عرض كل مواعيد اليوم
                  </button>
                </div>
              )}

              {/* Selected Slot Info */}
              {selectedSlot && (
                <div className="p-3 rounded-xl border" style={{ borderColor: '#10B981', background: 'rgba(16,185,129,0.05)' }}>
                  <p className="text-xs text-emerald-400 mb-1">✓ الموعد متاح</p>
                  <p className="text-sm text-white">الحلاق: {selectedSlot.barberName}</p>
                  <p className="text-xs text-zinc-500">الوقت: {formatTimeDisplay(selectedSlot.time)}</p>
                  {endTime && <p className="text-xs text-zinc-500">الانتهاء: {formatTimeDisplay(endTime)}</p>}
                </div>
              )}

              {/* Time Not Available Warning */}
              {!loadingSlots && availableSlots.length > 0 && !isTimeAvailable && (
                <div className="flex items-center gap-2 p-3 rounded-xl border border-red-500/30 bg-red-500/5">
                  <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400">هذا الموعد غير متاح لهذه الخدمة، اختر موعدًا آخر.</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Customer Info */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStep(2)}
                  className="p-2 rounded-lg border text-zinc-400 hover:text-white transition-colors"
                  style={{ borderColor: '#2A2A35' }}
                >
                  <ChevronRight size={16} />
                </button>
                <p className="text-sm text-zinc-400">بيانات العميل</p>
              </div>

              {/* Selected Slot Summary */}
              {selectedSlot && (
                <div className="p-3 rounded-xl border" style={{ borderColor: '#2A2A35', background: '#1A1A20' }}>
                  <p className="text-xs text-zinc-500 mb-2">ملخص الحجز:</p>
                  <p className="text-sm text-white">الحلاق: <span className="text-amber-400">{selectedSlot.barberName}</span></p>
                  <p className="text-sm text-white">التاريخ: <span className="text-amber-400">{formatDateLabel(bookingDate)}</span></p>
                  <p className="text-sm text-white">الوقت: <span className="text-amber-400">{formatTimeDisplay(bookingTime)}</span></p>
                  {selectedService && (
                    <p className="text-sm text-white">الخدمة: <span className="text-amber-400">{selectedService.ProName}</span></p>
                  )}
                </div>
              )}

              {/* Existing Client Search */}
              <div className="relative">
                <p className="text-xs font-semibold text-zinc-400 mb-2">بحث عن عميل موجود</p>
                {selectedClient ? (
                  <div className="flex items-center justify-between p-3 rounded-xl border" style={{ borderColor: '#10B981', background: 'rgba(16,185,129,0.05)' }}>
                    <div className="flex items-center gap-2">
                      <User size={16} className="text-emerald-400" />
                      <div>
                        <p className="text-sm text-white">{selectedClient.Name}</p>
                        {selectedClient.Mobile && <p className="text-xs text-zinc-500">{selectedClient.Mobile}</p>}
                      </div>
                    </div>
                    <button onClick={() => setSelectedClient(null)} className="p-1 text-zinc-500 hover:text-white">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 p-3 rounded-xl border" style={{ borderColor: '#2A2A35', background: '#1A1A20' }}>
                      <Search size={16} className="text-zinc-500" />
                      <input
                        className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
                        placeholder="ابحث بالاسم أو الهاتف..."
                        value={clientSearch}
                        onChange={(e) => { setClientSearch(e.target.value); setShowClients(true); }}
                      />
                    </div>
                    {showClients && clients.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border shadow-xl z-10 overflow-hidden" style={{ background: '#1E1D21', borderColor: '#2A2A35' }}>
                        {clients.slice(0, 6).map((c: Client) => (
                          <button
                            key={c.ClientID}
                            className="w-full text-right px-4 py-2.5 hover:bg-zinc-800 transition-colors text-sm text-white"
                            onClick={() => { setSelectedClient(c); setClientSearch(''); setShowClients(false); }}
                          >
                            {c.Name}
                            {c.Mobile && <span className="text-zinc-500 text-xs mr-2">{c.Mobile}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* New Customer Form */}
              <div>
                <p className="text-xs font-semibold text-zinc-400 mb-2">أو إدخال بيانات جديدة</p>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="اسم العميل *"
                    className="w-full rounded-xl border px-3 py-2.5 text-sm text-white bg-transparent placeholder-zinc-600 outline-none"
                    style={{ borderColor: '#2A2A35' }}
                  />
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="رقم الهاتف (اختياري)"
                    className="w-full rounded-xl border px-3 py-2.5 text-sm text-white bg-transparent placeholder-zinc-600 outline-none"
                    style={{ borderColor: '#2A2A35' }}
                    dir="ltr"
                  />
                </div>
              </div>

              {/* Error Display */}
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-xl border border-red-500/30 bg-red-500/5">
                  <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex-shrink-0" style={{ borderColor: '#2A2A35' }}>
          {step === 1 && (
            <button
              onClick={() => setStep(2)}
              disabled={!canProceed[1]}
              className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg,#D4AF37,#B8941F)', color: '#000' }}
            >
              التالي <ChevronLeft size={16} />
            </button>
          )}
          
          {step === 2 && (
            <button
              onClick={() => setStep(3)}
              disabled={!canProceed[2]}
              className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg,#D4AF37,#B8941F)', color: '#000' }}
            >
              التالي <ChevronLeft size={16} />
            </button>
          )}
          
          {step === 3 && (
            <button
              onClick={handleSubmit}
              disabled={!canProceed[3] || submitting}
              className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg,#10B981,#059669)', color: '#fff' }}
            >
              {submitting ? (
                <><Loader2 size={16} className="animate-spin" /> جاري الحجز...</>
              ) : (
                <><CheckCircle2 size={16} /> تأكيد الحجز</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
