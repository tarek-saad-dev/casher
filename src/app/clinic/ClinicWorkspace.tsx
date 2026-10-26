'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  CircleDollarSign,
  FileHeart,
  Plus,
  Search,
  Stethoscope,
  UserPlus,
  UserRound,
} from 'lucide-react';

type Patient = {
  ClientID: number;
  Name: string;
  Mobile: string | null;
  BirthDate: string | null;
  Address: string | null;
};

type Practitioner = {
  EmpID: number;
  EmpName: string;
  Job?: string | null;
  UserID?: number | null;
};

type PatientEncounter = {
  EncounterId: string;
  PractitionerName: string;
  Status: string;
  CreatedAt: string;
};

type StaffLogin = { UserID: number; UserName: string; loginName: string };

export default function ClinicWorkspace() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [encounters, setEncounters] = useState<PatientEncounter[]>([]);
  const [encountersLoading, setEncountersLoading] = useState(false);
  const [encountersError, setEncountersError] = useState<string | null>(null);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [doctorId, setDoctorId] = useState('');
  const [complaint, setComplaint] = useState('');
  const [visitType, setVisitType] = useState<'new' | 'follow_up' | 'procedure'>('new');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMobile, setNewMobile] = useState('');

  const [newDoctorOpen, setNewDoctorOpen] = useState(false);
  const [newDoctorName, setNewDoctorName] = useState('');
  const [linkDoctorToCurrentUser, setLinkDoctorToCurrentUser] = useState(false);
  const [staffLogins, setStaffLogins] = useState<StaffLogin[]>([]);
  const [doctorUserId, setDoctorUserId] = useState('');

  useEffect(() => {
    if (!newDoctorOpen) return;
    let active = true;
    void fetch('/api/users')
      .then(res => res.ok ? res.json() : [])
      .then((rows: StaffLogin[]) => { if (active) setStaffLogins(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (active) setStaffLogins([]); });
    return () => { active = false; };
  }, [newDoctorOpen]);

  async function loadPractitioners() {
    try {
      const res = await fetch('/api/clinic/practitioners');
      const rows = res.ok ? ((await res.json()) as Practitioner[]) : [];
      setPractitioners(Array.isArray(rows) ? rows : []);
    } catch {
      setPractitioners([]);
    }
  }

  useEffect(() => {
    void loadPractitioners();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setEncounters([]);
    setEncountersError(null);
    if (!patient) {
      setEncountersLoading(false);
      return;
    }
    setEncountersLoading(true);
    void fetch(`/api/clinic/encounters?clientId=${patient.ClientID}`, { signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error('تعذر تحميل الزيارات');
        return res.json() as Promise<PatientEncounter[]>;
      })
      .then(rows => { if (!controller.signal.aborted) setEncounters(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!controller.signal.aborted) setEncountersError('تعذر تحميل الزيارات'); })
      .finally(() => { if (!controller.signal.aborted) setEncountersLoading(false); });
    return () => controller.abort();
  }, [patient]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1 || patient) {
      setPatients([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/customers?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: Patient[]) => { if (!controller.signal.aborted) setPatients(Array.isArray(rows) ? rows : []); })
        .catch(() => { if (!controller.signal.aborted) setPatients([]); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, patient]);

  const selectedDoctor = useMemo(
    () => practitioners.find((x) => String(x.EmpID) === doctorId) ?? null,
    [doctorId, practitioners],
  );

  async function createPatient(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), mobile: newMobile.trim() || null }),
      });
      const data = (await res.json()) as Patient & { error?: string };
      if (!res.ok) throw new Error(data.error || 'تعذر إضافة المريض');
      setPatient(data);
      setQuery(data.Name);
      setPatients([]);
      setNewName('');
      setNewMobile('');
      setNewPatientOpen(false);
      setMessage('تم إضافة المريض واختياره.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'تعذر إضافة المريض');
    } finally {
      setBusy(false);
    }
  }

  async function createDoctor(e: FormEvent) {
    e.preventDefault();
    const name = newDoctorName.trim();
    if (!name || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/clinic/practitioners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, linkCurrentUser: linkDoctorToCurrentUser, userId: doctorUserId ? Number(doctorUserId) : null }),
      });
      const data = (await res.json()) as Practitioner & { error?: string };
      if (!res.ok || !data.EmpID) throw new Error(data.error || 'تعذر إضافة الطبيب');
      await loadPractitioners();
      setDoctorId(String(data.EmpID));
      setNewDoctorName('');
      setLinkDoctorToCurrentUser(false);
      setDoctorUserId('');
      setNewDoctorOpen(false);
      setMessage(`تم تجهيز د. ${data.EmpName} للحجز والزيارات في الفرع الحالي.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'تعذر إضافة الطبيب');
    } finally {
      setBusy(false);
    }
  }

  async function startEncounter() {
    if (!patient || !doctorId || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/clinic/encounters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: patient.ClientID,
          practitionerEmpId: Number(doctorId),
          visitType,
          chiefComplaint: complaint.trim() || null,
        }),
      });
      const data = (await res.json()) as { encounterId?: string; error?: string };
      if (!res.ok || !data.encounterId) throw new Error(data.error || 'تعذر بدء الزيارة');
      setComplaint('');
      router.push(`/clinic/encounters/${data.encounterId}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'تعذر بدء الزيارة');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-slate-50 p-4 text-slate-950 sm:p-6" dir="rtl">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-cyan-700">
              <Stethoscope className="h-4 w-4" />
              DRVO Clinics
            </div>
            <h1 className="mt-1 text-3xl font-black">المرضى والأطباء</h1>
            <p className="mt-1 text-sm text-slate-500">
              إضافة المرضى وتجهيز الأطباء وبدء زيارة بدون حجز مسبق
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/clinic" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold">العودة للاستقبال</Link>
            <Link
              href="/bookings"
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold"
            >
              <CalendarDays className="h-4 w-4" /> المواعيد
            </Link>
            <Link
              href="/income/pos"
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold"
            >
              <CircleDollarSign className="h-4 w-4" /> الحسابات
            </Link>
          </div>
        </header>

        <section className="mt-6 grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">المريض</h2>
                <p className="text-xs text-slate-500">ابحث بالاسم أو رقم الموبايل.</p>
              </div>
              <button
                type="button"
                onClick={() => setNewPatientOpen((x) => !x)}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white"
              >
                <Plus className="h-4 w-4" /> مريض جديد
              </button>
            </div>

            {newPatientOpen && (
              <form
                onSubmit={createPatient}
                className="mt-4 grid gap-2 rounded-2xl border bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]"
              >
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="اسم المريض"
                  className="rounded-xl border bg-white px-3 py-2 text-sm"
                />
                <input
                  value={newMobile}
                  onChange={(e) => setNewMobile(e.target.value)}
                  placeholder="رقم الموبايل"
                  className="rounded-xl border bg-white px-3 py-2 text-sm"
                  dir="ltr"
                />
                <button
                  disabled={busy || !newName.trim()}
                  className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  إضافة
                </button>
              </form>
            )}

            <div className="relative mt-4">
              <Search className="absolute right-3 top-3 h-4 w-4 text-slate-400" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPatient(null); setPatients([]); }}
                placeholder="اكتب اسم المريض أو رقم الموبايل"
                className="w-full rounded-2xl border bg-white py-2.5 pl-3 pr-10 text-sm outline-none focus:border-cyan-500"
              />
            </div>

            {patients.length > 0 && (
              <div className="mt-2 overflow-hidden rounded-2xl border">
                {patients.map((item) => (
                  <button
                    key={item.ClientID}
                    type="button"
                    onClick={() => {
                      setPatient(item);
                      setQuery(item.Name);
                      setPatients([]);
                    }}
                    className="flex w-full items-center gap-3 border-b px-4 py-3 text-right last:border-0 hover:bg-slate-50"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-cyan-50 text-cyan-700">
                      <UserRound className="h-4 w-4" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-bold">{item.Name}</span>
                      <span className="text-xs text-slate-500">{item.Mobile || 'بدون رقم'}</span>
                    </span>
                    <ChevronLeft className="h-4 w-4 text-slate-400" />
                  </button>
                ))}
              </div>
            )}

            {patient && (
              <div className="mt-4 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-cyan-700">
                    <FileHeart className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="font-black">{patient.Name}</div>
                    <div className="text-xs text-slate-500">
                      {patient.Mobile || 'بدون رقم موبايل'}
                      {patient.BirthDate ? ` • ${String(patient.BirthDate).slice(0, 10)}` : ''}
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <h3 className="text-sm font-bold">زيارات المريض</h3>
                  {encountersLoading && <p className="text-xs text-slate-500">جاري تحميل الزيارات…</p>}
                  {encountersError && <p role="alert" className="text-xs text-rose-700">{encountersError}</p>}
                  {!encountersLoading && !encountersError && encounters.length === 0 && <p className="text-xs text-slate-500">لا توجد زيارات مسجلة.</p>}
                  {encounters.map(visit => (
                    <Link key={visit.EncounterId} href={`/clinic/encounters/${visit.EncounterId}`} className="block rounded-xl border bg-white p-3 text-sm">
                      <strong>{visit.PractitionerName}</strong> • {String(visit.CreatedAt).slice(0, 10)}
                      <span className="mr-2 text-xs text-slate-500">{visit.Status === 'completed' ? 'مكتملة' : visit.Status === 'cancelled' ? 'ملغية' : visit.Status === 'scheduled' ? 'مجدولة' : 'جارية'}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">زيارة بدون حجز مسبق</h2>
                <p className="text-xs text-slate-500">
                  اختار المريض والطبيب وسجّل سبب الزيارة.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setNewDoctorName(selectedDoctor?.EmpName ?? ''); setNewDoctorOpen((x) => !x); }}
                className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold"
              >
                <UserPlus className="h-4 w-4" /> {selectedDoctor ? 'إعداد حساب الطبيب' : 'إضافة طبيب'}
              </button>
            </div>

            {newDoctorOpen && (
              <form
                onSubmit={createDoctor}
                className="mt-4 grid gap-3 rounded-2xl border bg-slate-50 p-3"
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    value={newDoctorName}
                    onChange={(e) => setNewDoctorName(e.target.value)}
                    placeholder="اسم الطبيب"
                    className="rounded-xl border bg-white px-3 py-2 text-sm"
                  />
                  <button
                    disabled={busy || !newDoctorName.trim()}
                    className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    إضافة الطبيب
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={linkDoctorToCurrentUser}
                    onChange={(e) => { setLinkDoctorToCurrentUser(e.target.checked); setDoctorUserId(''); }}
                  />
                  أنا الطبيب ده — اربط حساب دخولي بالطبيب علشان أقدر أسجل التشخيص وأوقّع الروشتة.
                </label>
                <label className="grid gap-1 text-xs text-slate-600">
                  <span>أو اربط الطبيب بحساب موظف موجود</span>
                  <select aria-label="أو اربط الطبيب بحساب موظف موجود" value={doctorUserId} onChange={e => { setDoctorUserId(e.target.value); setLinkDoctorToCurrentUser(false); }} className="rounded-xl border bg-white px-3 py-2 text-sm">
                    <option value="">بدون ربط حساب آخر</option>
                    {staffLogins.map(user => <option key={user.UserID} value={user.UserID}>{user.UserName} ({user.loginName})</option>)}
                  </select>
                  <span>مسؤول المنشأة يربط حساب الطبيب؛ البيانات الطبية متاحة لطبيب الزيارة فقط.</span>
                </label>
              </form>
            )}

            {practitioners.length === 0 && !newDoctorOpen && (
              <div className="mt-4 rounded-2xl border border-dashed p-4 text-xs leading-6 text-slate-500">
                مفيش طبيب متسجل في الفرع الحالي لسه. أضف أول طبيب علشان تبدأ الزيارات والحجز.
              </div>
            )}

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-xs font-bold text-slate-600">الطبيب</span>
                <select
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  className="rounded-xl border bg-white px-3 py-2.5 text-sm"
                >
                  <option value="">اختار الطبيب</option>
                  {practitioners.map((emp) => (
                    <option key={emp.EmpID} value={emp.EmpID}>
                      {emp.EmpName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-bold text-slate-600">نوع الزيارة</span>
                <select
                  value={visitType}
                  onChange={(e) => setVisitType(e.target.value as typeof visitType)}
                  className="rounded-xl border bg-white px-3 py-2.5 text-sm"
                >
                  <option value="new">كشف جديد</option>
                  <option value="follow_up">متابعة</option>
                  <option value="procedure">إجراء</option>
                </select>
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-bold text-slate-600">
                  سبب الزيارة / الشكوى الرئيسية
                </span>
                <textarea
                  value={complaint}
                  onChange={(e) => setComplaint(e.target.value)}
                  rows={4}
                  className="resize-none rounded-xl border bg-white px-3 py-2.5 text-sm"
                  placeholder="مثال: صداع متكرر منذ 3 أيام"
                />
              </label>

              <button
                type="button"
                onClick={() => void startEncounter()}
                disabled={!patient || !doctorId || busy}
                className="rounded-xl bg-cyan-600 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? 'جاري الحفظ…' : 'فتح الزيارة'}
              </button>
            </div>

            {message && (
              <div className="mt-4 rounded-2xl border bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-700">
                {message}
              </div>
            )}
          </div>
        </section>

        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900">
          الـAI Receptionist مسموح له بالحجز والتعديل والتذكير الإداري فقط. إكمال الزيارة،
          التشخيص وتوقيع الروشتة متروكين للطبيب البشري.
        </div>
      </div>
    </main>
  );
}
