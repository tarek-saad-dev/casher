'use client';

import { useState, useEffect } from 'react';
import { X, User, Scissors, Loader2, CheckCircle2, Clock, Users, AlertCircle, ArrowRight, ArrowLeft } from 'lucide-react';

interface Service {
  ProID: number;
  ProName: string;
  DurationMinutes: number | null;
}

interface Barber {
  EmpID: number;
  EmpName: string;
  IsWorkingDay: boolean;
  nextAvailableAt?: string;
  waitingCount?: number;
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

interface CreateResult {
  ok: boolean;
  ticketCode: string;
  queueTicketId: number;
  empName: string;
  estimatedStartTime: string;
  estimatedEndTime: string;
  peopleBefore: number;
  error?: string;
  newSuggestion?: SimulateResult;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
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

export function SimpleCreateQueueDrawer({ isOpen, onClose, onCreated }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [selectedBarber, setSelectedBarber] = useState<Barber | null>(null);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [simulateResult, setSimulateResult] = useState<SimulateResult | null>(null);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load barbers on open
  useEffect(() => {
    if (!isOpen) {
      // Reset state when closed
      setStep(1);
      setSelectedBarber(null);
      setSelectedService(null);
      setSimulateResult(null);
      setCreateResult(null);
      setError(null);
      return;
    }

    setLoading(true);
    fetch('/api/public/booking/barbers')
      .then(r => r.json())
      .then(d => {
        const activeBarbers = (d.barbers || []).filter((b: Barber) => b.IsWorkingDay);
        setBarbers(activeBarbers);
      })
      .catch(() => setError('فشل تحميل الصنايعية'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Call simulate when barber and service selected
  useEffect(() => {
    if (!selectedBarber || !selectedService) return;

    setLoading(true);
    setError(null);

    fetch('/api/operations/queue/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empId: selectedBarber.EmpID,
        serviceIds: [selectedService.ProID],
        requestedAt: new Date().toISOString(),
      }),
    })
      .then(r => r.json())
      .then((result: SimulateResult) => {
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

  const handleCreate = async () => {
    if (!simulateResult || !selectedBarber || !selectedService) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/operations/queue/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: selectedBarber.EmpID,
          serviceIds: [selectedService.ProID],
          customer: { name: 'عميل مباشر', phone: '' },
          expectedStartTime: simulateResult.suggestedStartTime,
          expectedEndTime: simulateResult.suggestedEndTime,
          source: 'walk_in',
        }),
      });

      const result: CreateResult = await res.json();

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
      // Show success for 2 seconds then close
      setTimeout(() => {
        onCreated();
        onClose();
      }, 2000);
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
              ) : barbers.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  لا يوجد صنايعية متاحين
                </div>
              ) : (
                barbers.map(barber => (
                  <button
                    key={barber.EmpID}
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
                          <div className="font-semibold text-gray-900">{barber.EmpName}</div>
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
                <div className="font-semibold text-blue-900">{selectedBarber.EmpName}</div>
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
                      الدور المتوقع مع {selectedBarber.EmpName}
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
  );
}
