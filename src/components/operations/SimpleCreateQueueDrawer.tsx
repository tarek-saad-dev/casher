'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, User, Scissors, Loader2, CheckCircle2, Clock, Users, AlertCircle, ArrowRight, ArrowLeft, Search, Phone, UserPlus, CheckCircle } from 'lucide-react';
import type { Customer } from '@/lib/types';
import type { CreateQueueResponse } from '@/lib/operationsQueueTypes';
import { PrintQueueTicketModal } from './PrintQueueTicketModal';

interface Service {
  ProID: number;
  ProName: string;
  DurationMinutes: number | null;
}

interface Barber {
  empId: number;
  empName: string;
  status: 'working' | 'off' | 'day_off' | 'absent' | 'not_checked_in' | 'unknown';
  workStart: string | null;
  workEnd: string | null;
  isOvernightShift: boolean;
  nextAvailableAt: string | null;
  waitingCount: number;
  bookingsCount: number;
}

interface SimulateResult {
  ok: boolean;
  decision: 'start_now' | 'after_queue' | 'after_booking' | 'outside_hours' | 'no_gap_found';
  empId: number;
  empName: string;
  serviceDurationMinutes: number;
  suggestedStartTime: string;
  suggestedEndTime: string;
  peopleBefore: number;
  message: string;
  timeline: Array<{
    type: 'queue' | 'booking' | 'gap';
    label: string;
    startTime: string;
    endTime: string;
    status: string;
  }>;
}

interface CreateResult extends CreateQueueResponse {
  error?: string;
  newSuggestion?: SimulateResult;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  barbers: Barber[];
  debugInfo?: { source: string; count: number; timestamp: string };
}

const SERVICES: Service[] = [
  { ProID: 1, ProName: 'Hair Cut', DurationMinutes: 30 },
  { ProID: 2, ProName: 'Beard Styling & Fade', DurationMinutes: 30 },
  { ProID: 3, ProName: 'Haircut & Beard', DurationMinutes: 45 },
  { ProID: 4, ProName: 'Fade Cut', DurationMinutes: 30 },
  { ProID: 5, ProName: 'Advanced Cut', DurationMinutes: 45 },
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? 'ص' : 'م';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

export function SimpleCreateQueueDrawer({ isOpen, onClose, onCreated, barbers, debugInfo }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedBarber, setSelectedBarber] = useState<Barber | null>(null);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [simulateResult, setSimulateResult] = useState<SimulateResult | null>(null);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);

  // Customer info - optional
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [isSearchingCustomer, setIsSearchingCustomer] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);
  const [customerFound, setCustomerFound] = useState<boolean | null>(null);

  const customerDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Debug logging - show all barbers and filtering
  useEffect(() => {
    if (!isOpen) return;

    console.log('[create queue] DEBUG INFO:', debugInfo);
    console.log('[create queue] all barbers received:', barbers.map(b => ({
      empId: b.empId,
      name: b.empName,
      status: b.status,
      workStart: b.workStart,
      workEnd: b.workEnd,
      isOvernightShift: b.isOvernightShift,
      nextAvailableAt: b.nextAvailableAt,
      waitingCount: b.waitingCount,
    })));

    // Specifically check for Omar (empId=25)
    const omar = barbers.find(b => b.empId === 25);
    if (omar) {
      console.log('[create queue] FOUND Omar (empId=25):', {
        empId: omar.empId,
        name: omar.empName,
        status: omar.status,
        workStart: omar.workStart,
        workEnd: omar.workEnd,
        isOvernightShift: omar.isOvernightShift,
        nextAvailableAt: omar.nextAvailableAt,
        waitingCount: omar.waitingCount,
      });
    } else {
      console.log('[create queue] Omar (empId=25) NOT FOUND in barbers list');
    }

    // Show filtered barbers (working only, not off/day_off)
    const workingBarbers = barbers.filter(b => b.status === 'working');
    console.log('[create queue] filtered working barbers:', workingBarbers.map(b => ({
      empId: b.empId,
      name: b.empName,
      status: b.status,
      nextAvailableAt: b.nextAvailableAt,
      waitingCount: b.waitingCount,
    })));
  }, [isOpen, barbers, debugInfo]);

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setSelectedBarber(null);
      setSelectedService(null);
      setSimulateResult(null);
      setCreateResult(null);
      setError(null);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerId(null);
      setCustomerFound(null);
      setCustomerSearchError(null);
    }
  }, [isOpen]);

  // Call simulate when barber and service selected
  useEffect(() => {
    if (!selectedBarber || !selectedService) return;

    setLoading(true);
    setError(null);

    const browserNow = new Date();
    const simulatePayload = {
      empId: selectedBarber.empId,
      serviceIds: [selectedService.ProID],
      requestedAt: browserNow.toISOString(),
    };
    console.log('[simulate payload]', {
      empId: selectedBarber.empId,
      serviceIds: [selectedService.ProID],
      requestedAt: browserNow.toISOString(),
      browserNowLocal: browserNow.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }),
      browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      barberName: selectedBarber.empName,
      serviceName: selectedService.ProName,
      serviceDuration: selectedService.DurationMinutes,
    });

    fetch('/api/operations/queue/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(simulatePayload),
    })
      .then(r => r.json())
      .then((result: SimulateResult) => {
        console.log('=== SIMULATE RESPONSE ===', result);
        setSimulateResult(result);
        if (result.decision === 'outside_hours') {
          setError('الصنايعي خارج مواعيد العمل');
        } else {
          setStep(3);
        }
      })
      .catch(() => setError('فشل في حساب الوقت المتوقع'))
      .finally(() => setLoading(false));
  }, [selectedBarber, selectedService]);

  // Customer search function with debounce
  const searchCustomerByPhone = useCallback(async (phone: string) => {
    if (!phone || phone.length < 7) {
      setCustomerFound(null);
      setCustomerSearchError(null);
      return;
    }

    setIsSearchingCustomer(true);
    setCustomerSearchError(null);

    try {
      // Use existing POS customer search endpoint
      const res = await fetch(`/api/customers?q=${encodeURIComponent(phone)}`);
      if (!res.ok) throw new Error('فشل البحث');

      const data: Customer[] = await res.json();

      // Find exact match by phone
      const matched = data.find((c) =>
        c.Mobile === phone || c.Mobile?.includes(phone)
      );

      if (matched) {
        setCustomerId(matched.ClientID);
        setCustomerName(matched.Name);
        setCustomerFound(true);
      } else {
        setCustomerId(null);
        setCustomerFound(false);
      }
    } catch {
      setCustomerSearchError('تعذر البحث عن العميل، يمكنك المتابعة يدويًا');
      setCustomerFound(null);
    } finally {
      setIsSearchingCustomer(false);
    }
  }, []);

  // Debounced phone search
  const handlePhoneChange = (value: string) => {
    setCustomerPhone(value);

    // Clear previous debounce
    if (customerDebounceRef.current) {
      clearTimeout(customerDebounceRef.current);
    }

    // Reset states when clearing
    if (!value.trim()) {
      setCustomerId(null);
      setCustomerFound(null);
      setCustomerSearchError(null);
      return;
    }

    // Debounce search
    customerDebounceRef.current = setTimeout(() => {
      searchCustomerByPhone(value.trim());
    }, 500);
  };

  const handleCreate = async () => {
    if (!simulateResult || !selectedBarber || !selectedService) return;
    console.log('=== CREATE START ===');

    setLoading(true);
    setError(null);

    try {
      const createPayload = {
        empId: selectedBarber.empId,
        serviceIds: [selectedService.ProID],
        customer: {
          clientId: customerId || undefined,
          name: customerName.trim() || (customerId ? undefined : 'عميل مباشر'),
          phone: customerPhone.trim() || undefined,
        },
        expectedStartTime: simulateResult.suggestedStartTime,
        expectedEndTime: simulateResult.suggestedEndTime,
        source: 'walk_in',
      };
      console.log('=== CREATE PAYLOAD ===', createPayload);

      const res = await fetch('/api/operations/queue/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload),
      });

      const result: CreateResult = await res.json();
      console.log('=== CREATE RESPONSE ===', result);
      console.log('Status:', res.status, 'OK:', result.ok, 'TicketCode:', result.ticketCode);

      if (!result.ok) {
        if (res.status === 409 && result.newSuggestion) {
          setSimulateResult(result.newSuggestion);
          setError('تم تحديث الوقت - الرجاء مراجعة الاقتراح الجديد');
        } else {
          setError(result.error || 'فشل في إنشاء الدور');
        }
        return;
      }

      setCreateResult(result);
      // Show print modal immediately after successful create
      setShowPrintModal(true);
    } catch {
      setError('فشل في إنشاء الدور');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 3) {
      setStep(2);
      setSimulateResult(null);
    } else if (step === 2) {
      setStep(1);
      setSelectedService(null);
    }
  };

  if (!isOpen) return null;

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-xl shadow-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-xl font-bold text-gray-900">
            {step === 1 && 'اختيار الصنايعي'}
            {step === 2 && 'اختيار الخدمة'}
            {step === 3 && 'تأكيد الدور'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          )}

          {/* Step 1: Select Barber */}
          {step === 1 && (
            <div className="space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
              ) : barbers.filter(b => b.status === 'working').length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  لا يوجد صنايعية متاحين للعمل
                </div>
              ) : (
                barbers.filter(b => b.status === 'working').map(barber => (
                  <button
                    key={barber.empId}
                    onClick={() => {
                      setSelectedBarber(barber);
                      setStep(2);
                    }}
                    className="w-full p-4 border rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all text-right"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                          <User className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900">{barber.empName}</div>
                          {barber.waitingCount !== undefined && barber.waitingCount > 0 && (
                            <div className="text-sm text-gray-500 flex items-center gap-1">
                              <Users className="w-4 h-4" />
                              {barber.waitingCount} في الانتظار
                            </div>
                          )}
                        </div>
                      </div>
                      {barber.nextAvailableAt && (
                        <div className="text-sm text-green-600 flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          متاح {formatTime(barber.nextAvailableAt)}
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Step 2: Select Service */}
          {step === 2 && selectedBarber && (
            <div className="space-y-3">
              <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                <div className="text-sm text-blue-600 mb-1">الصنايعي المختار:</div>
                <div className="font-semibold text-blue-900">{selectedBarber.empName}</div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                  <span className="mr-3 text-gray-600">جاري حساب الوقت...</span>
                </div>
              ) : (
                SERVICES.map(service => (
                  <button
                    key={service.ProID}
                    onClick={() => setSelectedService(service)}
                    className={`w-full p-4 border rounded-xl transition-all text-right ${
                      selectedService?.ProID === service.ProID
                        ? 'border-blue-500 bg-blue-50'
                        : 'hover:border-blue-500 hover:bg-blue-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                          <Scissors className="w-5 h-5 text-gray-600" />
                        </div>
                        <div className="font-medium text-gray-900">{service.ProName}</div>
                      </div>
                      <div className="text-sm text-gray-500">{service.DurationMinutes} دقيقة</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && simulateResult && selectedBarber && selectedService && (
            <div className="space-y-4">
              {/* Success Message */}
              {createResult ? (
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-center">
                  <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                  <div className="text-lg font-bold text-green-900 mb-1">
                    تم إنشاء الدور بنجاح
                  </div>
                  <div className="text-2xl font-bold text-green-700 mb-2">
                    {createResult.ticketCode}
                  </div>
                  <div className="text-sm text-green-600">
                    وقت الدخول: {formatTime(createResult.estimatedStartTime)}
                  </div>
                </div>
              ) : (
                <>
                  {/* Summary Card */}
                  <div className="p-4 bg-blue-50 rounded-xl">
                    <div className="text-lg font-bold text-blue-900 mb-3">
                      الدور المتوقع مع {selectedBarber.empName}
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <div className="text-sm text-blue-600">وقت الدخول</div>
                        <div className="text-xl font-bold text-blue-900">
                          {formatTime(simulateResult.suggestedStartTime)}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-blue-600">وقت الانتهاء</div>
                        <div className="text-xl font-bold text-blue-900">
                          {formatTime(simulateResult.suggestedEndTime)}
                        </div>
                      </div>
                    </div>

                    {/* Customer Info Section - Improved UI */}
                    <div className="bg-white rounded-xl border border-slate-200 p-4 mt-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-4">
                        <User className="w-4 h-4 text-slate-500" />
                        <span className="text-sm font-semibold text-slate-800">بيانات العميل</span>
                        <span className="text-xs text-slate-400">— اختياري</span>
                      </div>

                      <div className="space-y-3">
                        {/* Phone Input with Search */}
                        <div className="relative">
                          <label className="block text-xs font-medium text-slate-600 mb-1.5">رقم الهاتف</label>
                          <div className="relative">
                            <input
                              type="tel"
                              placeholder="01xxxxxxxxx"
                              value={customerPhone}
                              onChange={(e) => handlePhoneChange(e.target.value)}
                              className="w-full p-3 pr-10 border border-slate-300 rounded-lg text-right text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                            />
                            <div className="absolute left-3 top-1/2 -translate-y-1/2">
                              {isSearchingCustomer ? (
                                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                              ) : customerFound === true ? (
                                <CheckCircle className="w-4 h-4 text-emerald-500" />
                              ) : (
                                <Search className="w-4 h-4 text-slate-400" />
                              )}
                            </div>
                          </div>

                          {/* Search Status Messages */}
                          {customerFound === true && (
                            <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-600">
                              <CheckCircle className="w-3.5 h-3.5" />
                              <span>عميل موجود — تم ملء الاسم تلقائياً</span>
                            </div>
                          )}
                          {customerFound === false && customerPhone.length >= 7 && (
                            <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-600">
                              <UserPlus className="w-3.5 h-3.5" />
                              <span>عميل جديد — سيتم تسجيله عند إنشاء الدور</span>
                            </div>
                          )}
                          {customerSearchError && (
                            <div className="flex items-center gap-1.5 mt-2 text-xs text-red-500">
                              <AlertCircle className="w-3.5 h-3.5" />
                              <span>{customerSearchError}</span>
                            </div>
                          )}
                        </div>

                        {/* Name Input */}
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1.5">اسم العميل</label>
                          <input
                            type="text"
                            placeholder="اسم العميل"
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            className="w-full p-3 border border-slate-300 rounded-lg text-right text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                          />
                        </div>

                        {/* Customer Summary Card */}
                        {customerFound === true && customerId && (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mt-2">
                            <div className="flex items-center gap-2 text-emerald-700">
                              <CheckCircle className="w-4 h-4" />
                              <span className="text-xs font-medium">سيتم ربط الدور بالعميل رقم #{customerId}</span>
                            </div>
                          </div>
                        )}

                        {/* Empty State Hint */}
                        {!customerPhone && !customerName && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
                            <span>يمكنك إنشاء الدور بدون بيانات العميل أو إدخال رقم الهاتف للبحث</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-blue-700 mb-2">
                      <Users className="w-5 h-5" />
                      <span>قدامه: {simulateResult.peopleBefore} أشخاص</span>
                    </div>

                    <div className="text-sm text-blue-600">
                      {simulateResult.decision === 'start_now' && 'يمكنه الدخول الآن'}
                      {simulateResult.decision === 'after_queue' && 'سيدخل بعد الأدوار الحالية'}
                      {simulateResult.decision === 'after_booking' && 'تم وضعه بعد الحجز القادم للحفاظ على موعد الحجز'}
                    </div>
                  </div>

                  {/* Timeline */}
                  {simulateResult.timeline.length > 0 && (
                    <div className="border rounded-xl p-4">
                      <div className="text-sm font-semibold text-gray-700 mb-3">الجدول المتوقع:</div>
                      <div className="space-y-2">
                        {simulateResult.timeline
                          .filter(item => item.type !== 'gap')
                          .slice(0, 5)
                          .map((item, idx) => (
                            <div
                              key={idx}
                              className={`flex items-center justify-between p-2 rounded text-sm ${
                                item.type === 'queue'
                                  ? 'bg-orange-50 text-orange-700'
                                  : item.type === 'booking'
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-gray-50 text-gray-700'
                              }`}
                            >
                              <span className="font-medium">{item.label}</span>
                              <span>
                                {formatTime(item.startTime)} - {formatTime(item.endTime)}
                              </span>
                            </div>
                          ))}
                        <div className="flex items-center justify-between p-2 rounded text-sm bg-blue-100 text-blue-800 font-medium">
                          <span>الدور الجديد</span>
                          <span>
                            {formatTime(simulateResult.suggestedStartTime)} - {formatTime(simulateResult.suggestedEndTime)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Confirm Button */}
                  <button
                    onClick={handleCreate}
                    disabled={loading}
                    className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold text-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        جاري الإنشاء...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-5 h-5" />
                        تأكيد وإنشاء الدور
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer with Back Button */}
        {step > 1 && !createResult && (
          <div className="px-6 py-4 border-t bg-gray-50">
            <button
              onClick={handleBack}
              disabled={loading}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 disabled:opacity-50"
            >
              <ArrowRight className="w-4 h-4" />
              رجوع
            </button>
          </div>
        )}
      </div>
    </div>

    {/* Print Ticket Modal */}
    <PrintQueueTicketModal
      isOpen={showPrintModal}
      ticket={createResult}
      onClose={() => {
        setShowPrintModal(false);
        onCreated();
        onClose();
      }}
      onPrintComplete={() => {
        // Refresh scheduler after print
        onCreated();
      }}
    />
    </>
  );
}
