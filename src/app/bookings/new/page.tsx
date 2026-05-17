'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, Search, UserPlus, Scissors, Clock, CalendarDays,
  CheckCircle2, Loader2, AlertCircle, User,
} from 'lucide-react';

interface Barber  { EmpID: number; EmpName: string; }
interface Client  { ClientID: number; Name: string; ClientName: string; Mobile: string | null; ClientMobile: string | null; }
interface Service { ProID: number; ProName: string; SPrice: number; DurationMinutes?: number; }
interface SelSvc  extends Service { qty: number; empId: number | null; }

const SOURCE_OPTIONS = [
  { value: 'phone',    label: 'هاتف'           },
  { value: 'whatsapp', label: 'واتساب'         },
  { value: 'website',  label: 'موقع إلكتروني'  },
  { value: 'admin',    label: 'إداري'           },
  { value: 'walk_in',  label: 'حضور مباشر'      },
];

export default function NewBookingPage() {
  const router = useRouter();

  const [barbers,  setBarbers]  = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  const [clientSearch,   setClientSearch]   = useState('');
  const [clientResults,  setClientResults]  = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientLoading,  setClientLoading]  = useState(false);
  const [showNewClient,  setShowNewClient]  = useState(false);
  const [newClientName,  setNewClientName]  = useState('');
  const [newClientMobile,setNewClientMobile]= useState('');

  const [selectedBarber,   setSelectedBarber]   = useState<Barber | null>(null);
  const [selectedServices, setSelectedServices] = useState<SelSvc[]>([]);
  const [bookingDate,      setBookingDate]      = useState('');
  const [startTime,        setStartTime]        = useState('');
  const [endTime,          setEndTime]          = useState('');
  const [source,           setSource]           = useState('phone');
  const [notes,            setNotes]            = useState('');

  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [newBookingId, setNewBookingId] = useState<number | null>(null);

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/employees').then(r => r.json()),
      fetch('/api/services').then(r => r.json()),
    ]).then(([emp, svc]) => {
      setBarbers(Array.isArray(emp) ? emp.filter((e: Barber & { isActive?: number }) => e.isActive !== 0) : []);
      const rawSvc = Array.isArray(svc) ? svc : svc.services || [];
      setServices(rawSvc.map((s: { ProID: number; ProName: string; SPrice?: number; SPrice1?: number; DurationMinutes?: number }) => ({
        ...s,
        SPrice: s.SPrice ?? s.SPrice1 ?? 0,
      })));
    });
    // Default to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setBookingDate(tomorrow.toISOString().slice(0, 10));
    setStartTime('10:00');
  }, []);

  useEffect(() => {
    if (clientSearch.length < 2) { setClientResults([]); return; }
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(async () => {
      setClientLoading(true);
      try {
        const res = await fetch(`/api/customers?q=${encodeURIComponent(clientSearch)}`);
        const data = await res.json();
        const raw = Array.isArray(data) ? data : data.clients || [];
        setClientResults(raw.map((c: { ClientID: number; Name?: string; ClientName?: string; Mobile?: string | null }) => ({
          ...c,
          ClientName: c.ClientName ?? c.Name ?? '',
          ClientMobile: c.Mobile ?? null,
        })));
      } finally { setClientLoading(false); }
    }, 350);
  }, [clientSearch]);

  // Auto-compute end time from service durations
  useEffect(() => {
    if (!startTime) return;
    const totalMins = selectedServices.reduce((s, sv) => s + (sv.DurationMinutes || 30) * sv.qty, 0);
    if (!totalMins) { setEndTime(''); return; }
    const [h, m] = startTime.split(':').map(Number);
    const end = new Date(0, 0, 0, h, m + totalMins);
    setEndTime(`${String(end.getHours()).padStart(2,'0')}:${String(end.getMinutes()).padStart(2,'0')}`);
  }, [startTime, selectedServices]);

  // Check conflict
  useEffect(() => {
    if (!selectedBarber || !bookingDate || !startTime || !endTime) { setConflictWarning(null); return; }
    fetch(`/api/bookings?date=${bookingDate}&empId=${selectedBarber.EmpID}&status=all`)
      .then(r => r.json())
      .then(data => {
        const bks: Array<{ StartTime: string; EndTime: string | null; Status: string; ClientName: string | null }> = data.bookings || [];
        const conflicts = bks.filter(b => {
          if (['cancelled','no_show','rescheduled'].includes(b.Status)) return false;
          const bs = String(b.StartTime).slice(0, 5);
          const be = b.EndTime ? String(b.EndTime).slice(0, 5) : bs;
          return startTime < be && endTime > bs;
        });
        setConflictWarning(conflicts.length > 0 ? `تعارض مع ${conflicts.length} حجز موجود لـ ${selectedBarber.EmpName}` : null);
      });
  }, [selectedBarber, bookingDate, startTime, endTime]);

  const handleSvcToggle = (svc: Service) => {
    setSelectedServices(prev => {
      const ex = prev.find(s => s.ProID === svc.ProID);
      if (ex) return prev.filter(s => s.ProID !== svc.ProID);
      return [...prev, { ...svc, qty: 1, empId: selectedBarber?.EmpID ?? null }];
    });
  };

  const totalPrice = selectedServices.reduce((s, sv) => s + sv.SPrice * sv.qty, 0);

  const canSubmit = (selectedClient || (showNewClient && newClientName.trim())) &&
    bookingDate && startTime && selectedServices.length > 0;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let clientId = selectedClient?.ClientID ?? null;
      if (showNewClient && newClientName.trim()) {
        const cRes = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newClientName.trim(), mobile: newClientMobile.trim() || null }),
        });
        const cData = await cRes.json();
        clientId = cData.ClientID ?? null;
      }

      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          empId: selectedBarber?.EmpID ?? null,
          bookingDate,
          startTime,
          endTime: endTime || null,
          source,
          notes: notes || null,
          services: selectedServices.map(s => ({
            proId: s.ProID, empId: s.empId || selectedBarber?.EmpID || null,
            qty: s.qty, price: s.SPrice, durationMinutes: s.DurationMinutes,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل إنشاء الحجز');
      setSuccess(true);
      setNewBookingId(data.bookingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ');
    } finally {
      setSubmitting(false);
    }
  };

  if (success && newBookingId) return (
    <div className="h-full flex flex-col items-center justify-center bg-zinc-950 text-center px-6" dir="rtl">
      <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
        style={{ background: 'rgba(16,185,129,0.15)', border: '2px solid rgba(16,185,129,0.4)' }}>
        <CheckCircle2 size={36} className="text-emerald-400" />
      </div>
      <h2 className="text-xl font-black text-white mb-2">تم إنشاء الحجز!</h2>
      <p className="text-zinc-400 text-sm mb-6">رقم الحجز: <span className="text-amber-400 font-bold">#{newBookingId}</span></p>
      <div className="flex gap-3">
        <button
          onClick={() => router.push(`/bookings/${newBookingId}`)}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: 'linear-gradient(135deg,#D6A84F,#B8923A)', color: '#000' }}
        >عرض الحجز</button>
        <button
          onClick={() => router.push('/bookings')}
          className="px-5 py-2.5 rounded-xl text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
        >كل الحجوزات</button>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-zinc-950" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800 shrink-0">
        <button onClick={() => router.push('/bookings')} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition-all">
          <ArrowRight size={16} />
        </button>
        <div>
          <h1 className="text-base font-black text-white">حجز جديد</h1>
          <p className="text-xs text-zinc-500">أدخل تفاصيل الحجز</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-luxury-v">
        <div className="max-w-2xl mx-auto p-6 space-y-6">

          {/* Client */}
          <Section title="العميل" icon={<User size={14}/>}>
            {!showNewClient ? (
              <>
                <div className="relative mb-3">
                  <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    value={clientSearch}
                    onChange={e => { setClientSearch(e.target.value); setSelectedClient(null); }}
                    placeholder="ابحث عن عميل..."
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pr-9 pl-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
                  />
                  {clientLoading && <Loader2 size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 animate-spin" />}
                </div>
                {clientResults.length > 0 && !selectedClient && (
                  <div className="border border-zinc-700 rounded-xl overflow-hidden mb-3">
                    {clientResults.map(c => (
                      <button key={c.ClientID} onClick={() => { setSelectedClient(c); setClientSearch(c.ClientName); setClientResults([]); }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors text-right border-b border-zinc-800 last:border-0">
                        <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white">{c.ClientName.charAt(0)}</div>
                        <div><p className="text-sm font-medium text-white">{c.ClientName}</p>{c.ClientMobile && <p className="text-xs text-zinc-500">{c.ClientMobile}</p>}</div>
                      </button>
                    ))}
                  </div>
                )}
                {selectedClient ? (
                  <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 mb-2">
                    <CheckCircle2 size={15} className="text-emerald-400" />
                    <div className="flex-1"><p className="text-sm font-semibold text-white">{selectedClient.ClientName}</p>{selectedClient.ClientMobile && <p className="text-xs text-zinc-400">{selectedClient.ClientMobile}</p>}</div>
                    <button onClick={() => { setSelectedClient(null); setClientSearch(''); }} className="text-xs text-zinc-500 hover:text-white">تغيير</button>
                  </div>
                ) : null}
                <button onClick={() => setShowNewClient(true)} className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300">
                  <UserPlus size={13}/> عميل جديد
                </button>
              </>
            ) : (
              <div className="space-y-3">
                <div><label className="text-xs text-zinc-400 mb-1 block">الاسم *</label>
                  <input value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="الاسم الكامل" className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50" /></div>
                <div><label className="text-xs text-zinc-400 mb-1 block">الجوال</label>
                  <input value={newClientMobile} onChange={e => setNewClientMobile(e.target.value)} placeholder="05XXXXXXXX" dir="ltr" className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50" /></div>
                <button onClick={() => { setShowNewClient(false); setNewClientName(''); setNewClientMobile(''); }} className="text-xs text-zinc-500 hover:text-zinc-300">← العودة للبحث</button>
              </div>
            )}
          </Section>

          {/* Date & Time */}
          <Section title="التاريخ والوقت" icon={<CalendarDays size={14}/>}>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="text-xs text-zinc-400 mb-1 block">التاريخ *</label>
                <input type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">وقت البداية *</label>
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">وقت النهاية</label>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50" />
              </div>
            </div>
            {conflictWarning && (
              <div className="mt-2 flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
                <AlertCircle size={13}/>{conflictWarning}
              </div>
            )}
          </Section>

          {/* Barber */}
          <Section title="الحلاق" icon={<User size={14}/>}>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setSelectedBarber(null)}
                className="flex items-center gap-2 p-3 rounded-xl border text-right transition-all"
                style={!selectedBarber ? { borderColor: 'rgba(214,168,79,0.5)', background: 'rgba(214,168,79,0.1)', color: '#D6A84F' } : { borderColor: '#2A2A35', background: 'transparent', color: '#9CA3AF' }}>
                <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs">—</div>
                <span className="text-sm font-medium">أي حلاق</span>
              </button>
              {barbers.map(b => (
                <button key={b.EmpID} onClick={() => setSelectedBarber(b)}
                  className="flex items-center gap-2 p-3 rounded-xl border text-right transition-all"
                  style={selectedBarber?.EmpID === b.EmpID ? { borderColor: 'rgba(214,168,79,0.5)', background: 'rgba(214,168,79,0.1)', color: '#D6A84F' } : { borderColor: '#2A2A35', background: 'transparent', color: '#D1D5DB' }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: selectedBarber?.EmpID === b.EmpID ? 'linear-gradient(135deg,#D6A84F,#B8923A)' : '#2A2A35', color: selectedBarber?.EmpID === b.EmpID ? '#000' : '#fff' }}>
                    {b.EmpName.charAt(0)}
                  </div>
                  <span className="text-sm font-medium truncate">{b.EmpName}</span>
                </button>
              ))}
            </div>
          </Section>

          {/* Services */}
          <Section title="الخدمات" icon={<Scissors size={14}/>}>
            <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-luxury-v">
              {services.map(svc => {
                const sel = selectedServices.find(s => s.ProID === svc.ProID);
                return (
                  <button key={svc.ProID} onClick={() => handleSvcToggle(svc)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border text-right transition-all"
                    style={sel ? { borderColor: 'rgba(139,92,246,0.4)', background: 'rgba(139,92,246,0.1)' } : { borderColor: '#2A2A35', background: 'rgba(255,255,255,0.02)' }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: sel ? 'rgba(139,92,246,0.2)' : '#2A2A35' }}>
                      {sel ? <CheckCircle2 size={14} className="text-purple-400"/> : <Scissors size={13} className="text-zinc-500"/>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{svc.ProName}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-amber-400 font-semibold">{svc.SPrice} ر.س</span>
                        {svc.DurationMinutes && <span className="text-xs text-zinc-500 flex items-center gap-1"><Clock size={9}/>{svc.DurationMinutes}د</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {selectedServices.length > 0 && (
              <div className="mt-3 p-3 rounded-xl bg-zinc-900 border border-zinc-800 flex justify-between items-center">
                <span className="text-xs text-zinc-400">{selectedServices.length} خدمة</span>
                <span className="text-sm font-bold text-amber-400">{totalPrice} ر.س</span>
              </div>
            )}
          </Section>

          {/* Source & Notes */}
          <Section title="إضافي" icon={<CalendarDays size={14}/>}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">مصدر الحجز</label>
                <select value={source} onChange={e => setSource(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/50">
                  {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label className="text-xs text-zinc-400 mb-1 block">ملاحظات</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="أي ملاحظات إضافية..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none resize-none" />
            </div>
          </Section>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              <AlertCircle size={14}/>{error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: canSubmit ? 'linear-gradient(135deg,#D6A84F,#B8923A)' : '#2A2A35', color: canSubmit ? '#000' : '#6B7280' }}
          >
            {submitting ? <><Loader2 size={16} className="animate-spin"/> جاري الحفظ...</> : <><CalendarDays size={16}/> حفظ الحجز</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-5" style={{ background: '#141418', borderColor: '#2A2A35' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="text-amber-400">{icon}</div>
        <h3 className="text-sm font-bold text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}
