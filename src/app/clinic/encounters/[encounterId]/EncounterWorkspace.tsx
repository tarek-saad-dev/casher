'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CalendarDays,
  ClipboardPlus,
  FileText,
  HeartPulse,
  Loader2,
  Pill,
  Plus,
  Printer,
  Save,
  Trash2,
  UserRound,
} from 'lucide-react';

type EncounterRow = {
  EncounterId: string;
  ClientID: number;
  PatientName: string;
  PatientMobile: string | null;
  BirthDate: string | null;
  PractitionerEmpID: number;
  PractitionerName: string;
  VisitType: 'new' | 'follow_up' | 'procedure';
  Status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  ChiefComplaint: string | null;
  ClinicalNotes: string | null;
  DiagnosisSummary: string | null;
  VitalsJson: string | null;
  FollowUpAt: string | null;
  StartedAt: string | null;
  CompletedAt: string | null;
};

type PatientProfile = {
  BloodType: string | null;
  Allergies: string | null;
  ChronicConditions: string | null;
  CurrentMedications: string | null;
  EmergencyContactName: string | null;
  EmergencyContactPhone: string | null;
  Notes: string | null;
};

type PrescriptionItemRow = {
  PrescriptionItemId: number;
  MedicationName: string;
  Strength: string | null;
  Dosage: string | null;
  Route: string | null;
  Frequency: string | null;
  Duration: string | null;
  Instructions: string | null;
};

type PrescriptionRow = {
  PrescriptionId: string;
  Status: 'draft' | 'signed' | 'void';
  Notes: string | null;
  SignedAt: string | null;
  CreatedAt: string;
  items: PrescriptionItemRow[];
};

type HistoryRow = {
  EncounterId: string;
  VisitType: string;
  Status: string;
  ChiefComplaint: string | null;
  DiagnosisSummary: string | null;
  StartedAt: string | null;
  CompletedAt: string | null;
  CreatedAt: string;
  PractitionerName: string;
};

type WorkspacePayload = {
  encounter: EncounterRow;
  patientProfile: PatientProfile | null;
  history: HistoryRow[];
  prescriptions: PrescriptionRow[];
  clinicalAccess: {
    linked: boolean;
    practitionerEmpId: number | null;
    assigned: boolean;
  };
};

type RxItem = {
  medicationName: string;
  strength: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  instructions: string;
};

const EMPTY_RX: RxItem = {
  medicationName: '',
  strength: '',
  dosage: '',
  route: '',
  frequency: '',
  duration: '',
  instructions: '',
};

function toInputDateTime(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function safeVitals(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, value == null ? '' : String(value)]),
    );
  } catch {
    return {};
  }
}

function statusLabel(status: EncounterRow['Status']) {
  if (status === 'completed') return 'مكتملة';
  if (status === 'cancelled') return 'ملغية';
  if (status === 'scheduled') return 'مجدولة';
  return 'جارية';
}

export default function EncounterWorkspace({ encounterId }: { encounterId: string }) {
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'exam' | 'prescription' | 'follow_up'>('exam');
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [bloodType, setBloodType] = useState('');
  const [allergies, setAllergies] = useState('');
  const [chronicConditions, setChronicConditions] = useState('');
  const [currentMedications, setCurrentMedications] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
  const [profileNotes, setProfileNotes] = useState('');

  const [clinicalNotes, setClinicalNotes] = useState('');
  const [diagnosisSummary, setDiagnosisSummary] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [bloodPressure, setBloodPressure] = useState('');
  const [temperature, setTemperature] = useState('');
  const [pulse, setPulse] = useState('');
  const [weight, setWeight] = useState('');
  const [oxygenSaturation, setOxygenSaturation] = useState('');

  const [rxItems, setRxItems] = useState<RxItem[]>([{ ...EMPTY_RX }]);
  const [rxNotes, setRxNotes] = useState('');

  const hydrate = useCallback((payload: WorkspacePayload) => {
    setData(payload);
    setDirty(false);
    const profile = payload.patientProfile;
    setBloodType(profile?.BloodType ?? '');
    setAllergies(profile?.Allergies ?? '');
    setChronicConditions(profile?.ChronicConditions ?? '');
    setCurrentMedications(profile?.CurrentMedications ?? '');
    setEmergencyContactName(profile?.EmergencyContactName ?? '');
    setEmergencyContactPhone(profile?.EmergencyContactPhone ?? '');
    setProfileNotes(profile?.Notes ?? '');

    setClinicalNotes(payload.encounter.ClinicalNotes ?? '');
    setDiagnosisSummary(payload.encounter.DiagnosisSummary ?? '');
    setFollowUpAt(toInputDateTime(payload.encounter.FollowUpAt));
    const vitals = safeVitals(payload.encounter.VitalsJson);
    setBloodPressure(vitals.bloodPressure ?? '');
    setTemperature(vitals.temperature ?? '');
    setPulse(vitals.pulse ?? '');
    setWeight(vitals.weight ?? '');
    setOxygenSaturation(vitals.oxygenSaturation ?? '');
  }, []);

  const reload = useCallback(async (preserveDraft = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clinic/encounters/${encodeURIComponent(encounterId)}`, {
        cache: 'no-store',
      });
      const payload = (await res.json()) as WorkspacePayload & { error?: string };
      if (!res.ok) throw new Error(payload.error || 'تعذر تحميل الزيارة');
      if (preserveDraft) setData(payload);
      else hydrate(payload);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'تعذر تحميل الزيارة');
    } finally {
      setLoading(false);
    }
  }, [encounterId, hydrate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const canClinicalAct =
    data?.clinicalAccess.linked === true &&
    data?.clinicalAccess.assigned === true;
  const canEdit = canClinicalAct && data?.encounter.Status === 'in_progress';

  const vitals = useMemo(
    () => ({
      bloodPressure: bloodPressure.trim() || null,
      temperature: temperature.trim() || null,
      pulse: pulse.trim() || null,
      weight: weight.trim() || null,
      oxygenSaturation: oxygenSaturation.trim() || null,
    }),
    [bloodPressure, temperature, pulse, weight, oxygenSaturation],
  );

  async function saveEncounter(action: 'save' | 'complete') {
    if (!canEdit || busy) return;
    if (action === 'complete' && rxItems.some((item) => item.medicationName.trim())) {
      setActiveTab('prescription');
      setNotice('فيه أدوية مكتوبة لسه ما اتحفظتش. احفظ مسودة الروشتة أو امسحها قبل إنهاء الكشف.');
      return;
    }
    if (action === 'complete' && !diagnosisSummary.trim()) {
      setNotice('اكتب ملخص التشخيص قبل إكمال الزيارة.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/clinic/encounters/${encodeURIComponent(encounterId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          clinicalNotes,
          diagnosisSummary,
          followUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
          vitals,
          patientProfile: {
            bloodType: bloodType || null,
            allergies,
            chronicConditions,
            currentMedications,
            emergencyContactName,
            emergencyContactPhone,
            notes: profileNotes,
          },
        }),
      });
      const result = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(result.error || 'تعذر حفظ الزيارة');
      setNotice(action === 'complete' ? 'تم إكمال الزيارة وحفظ الملف الطبي.' : 'تم حفظ الزيارة.');
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'تعذر حفظ الزيارة');
    } finally {
      setBusy(false);
    }
  }

  function updateRx(index: number, field: keyof RxItem, value: string) {
    setRxItems((current) =>
      current.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  }

  async function createPrescription() {
    if (!canEdit || busy) return;
    const validItems = rxItems.filter((item) => item.medicationName.trim());
    if (!validItems.length) {
      setNotice('أضف اسم دواء واحد على الأقل.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/clinic/encounters/${encodeURIComponent(encounterId)}/prescriptions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: rxNotes, items: validItems }),
        },
      );
      const result = (await res.json()) as { prescriptionId?: string; error?: string };
      if (!res.ok || !result.prescriptionId) {
        throw new Error(result.error || 'تعذر إنشاء الروشتة');
      }
      setRxItems([{ ...EMPTY_RX }]);
      setRxNotes('');
      setNotice('تم إنشاء مسودة الروشتة. راجعها ثم وقّعها.');
      await reload(true);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'تعذر إنشاء الروشتة');
    } finally {
      setBusy(false);
    }
  }

  async function signPrescription(prescriptionId: string) {
    if (!canClinicalAct || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/clinic/prescriptions/${encodeURIComponent(prescriptionId)}/sign`,
        { method: 'POST' },
      );
      const result = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(result.error || 'تعذر توقيع الروشتة');
      setNotice('تم توقيع الروشتة.');
      await reload(true);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'تعذر توقيع الروشتة');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <main className="grid min-h-full place-items-center bg-slate-50" dir="rtl">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> جاري تحميل الزيارة…
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-full bg-slate-50 p-6" dir="rtl">
        <div className="mx-auto max-w-3xl rounded-3xl border bg-white p-8 text-center">
          <p className="font-bold">{notice || 'تعذر تحميل الزيارة.'}</p>
          <Link href="/clinic" className="mt-4 inline-flex rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">
            الرجوع للعيادة
          </Link>
        </div>
      </main>
    );
  }

  const { encounter, prescriptions, clinicalAccess } = data;
  const signedPrescriptions = prescriptions.filter((rx) => rx.Status === 'signed');

  return (
    <main className="min-h-full overflow-y-auto bg-slate-50 p-4 text-slate-950 sm:p-6" dir="rtl">
      <div className="mx-auto max-w-7xl print:hidden">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/clinic" className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900">
              <ArrowRight className="h-4 w-4" /> تشغيل العيادة
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black">زيارة {encounter.PatientName}</h1>
              <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-800">
                {statusLabel(encounter.Status)}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              د. {encounter.PractitionerName} • {encounter.VisitType === 'follow_up' ? 'متابعة' : encounter.VisitType === 'procedure' ? 'إجراء' : 'كشف جديد'}
            </p>
          </div>
          <button
            type="button"
            disabled={signedPrescriptions.length === 0}
            onClick={() => window.print()}
            title={signedPrescriptions.length ? 'طباعة الروشتات الموقعة فقط' : 'اعتمد روشتة أولاً لتفعيل الطباعة'}
            className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Printer className="h-4 w-4" /> طباعة الروشتة
          </button>
        </header>

        {!clinicalAccess.linked && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">
            الحساب الحالي غير مربوط بطبيب. تقدر تقرأ الزيارة، لكن كتابة بيانات طبية أو تشخيص أو روشتة محتاجة ربط حساب الدخول بالطبيب من شاشة <Link href="/clinic" className="font-black underline">تشغيل العيادة</Link>.
          </div>
        )}
        {clinicalAccess.linked && !clinicalAccess.assigned && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">
            الحساب مربوط بطبيب مختلف عن الطبيب المسؤول عن الزيارة، لذلك الزيارة للقراءة فقط.
          </div>
        )}

        {notice && (
          <div className="mt-5 rounded-2xl border bg-white px-4 py-3 text-sm font-semibold">
            {notice}
          </div>
        )}

        <nav aria-label="مراحل الزيارة" className="mt-5 flex gap-2 rounded-2xl border border-slate-200 bg-white p-2">
          {([
            { id: 'exam', label: '01 — الكشف', icon: Activity },
            { id: 'prescription', label: '02 — الروشتة', icon: Pill },
            { id: 'follow_up', label: '03 — المتابعة', icon: CalendarDays },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={activeTab === tab.id}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-2 py-3 text-xs font-bold transition sm:text-sm ${activeTab === tab.id
                ? 'bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200'
                : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <tab.icon className="h-4 w-4" /> {tab.label}
            </button>
          ))}
        </nav>

        <section className="mt-5 grid items-start gap-4 xl:grid-cols-[.8fr_1.2fr]">
          <div className="space-y-4">
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <UserRound className="h-5 w-5 text-cyan-700" />
                <h2 className="font-black">بيانات المريض</h2>
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                <div><span className="text-slate-500">الاسم:</span> <strong>{encounter.PatientName}</strong></div>
                <div><span className="text-slate-500">الموبايل:</span> {encounter.PatientMobile || '—'}</div>
                <div><span className="text-slate-500">تاريخ الميلاد:</span> {encounter.BirthDate ? String(encounter.BirthDate).slice(0, 10) : '—'}</div>
                <div><span className="text-slate-500">سبب الزيارة:</span> {encounter.ChiefComplaint || '—'}</div>
              </div>
            </div>

            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-slate-700" />
                <h2 className="font-black">الزيارات السابقة</h2>
              </div>
              <div className="mt-4 space-y-2">
                {data.history.length === 0 && (
                  <div className="rounded-xl border border-dashed p-3 text-xs text-slate-500">
                    دي أول زيارة مسجلة للمريض على DRVO Clinics.
                  </div>
                )}
                {data.history.map((item) => (
                  <Link
                    key={item.EncounterId}
                    href={`/clinic/encounters/${item.EncounterId}`}
                    className="block rounded-xl border p-3 transition hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm">{item.PractitionerName}</strong>
                      <span className="text-[11px] text-slate-400">
                        {String(item.CreatedAt).slice(0, 10)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {item.DiagnosisSummary || item.ChiefComplaint || 'بدون ملخص'}
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            <details onChange={() => setDirty(true)} className="rounded-3xl border bg-white p-5 shadow-sm">
              <summary className="flex cursor-pointer items-center gap-2 font-black">
                <HeartPulse className="h-5 w-5 text-rose-600" />
                <span>التاريخ الطبي — عرض / تعديل</span>
              </summary>
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1">
                  <span className="text-xs font-bold text-slate-600">فصيلة الدم</span>
                  <select disabled={!canEdit} value={bloodType} onChange={(e) => setBloodType(e.target.value)} className="rounded-xl border bg-white px-3 py-2 text-sm disabled:bg-slate-50">
                    <option value="">غير محدد</option>
                    {['A+','A-','B+','B-','AB+','AB-','O+','O-','unknown'].map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-bold text-slate-600">الحساسية</span>
                  <textarea disabled={!canEdit} value={allergies} onChange={(e) => setAllergies(e.target.value)} rows={2} className="rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-bold text-slate-600">أمراض مزمنة</span>
                  <textarea disabled={!canEdit} value={chronicConditions} onChange={(e) => setChronicConditions(e.target.value)} rows={2} className="rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-bold text-slate-600">أدوية حالية</span>
                  <textarea disabled={!canEdit} value={currentMedications} onChange={(e) => setCurrentMedications(e.target.value)} rows={2} className="rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input disabled={!canEdit} value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} placeholder="اسم شخص للطوارئ" className="rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" />
                  <input disabled={!canEdit} value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} placeholder="رقم الطوارئ" dir="ltr" className="rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" />
                </div>
                <textarea disabled={!canEdit} value={profileNotes} onChange={(e) => setProfileNotes(e.target.value)} rows={2} placeholder="ملاحظات عامة على الملف الطبي" className="rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" />
              </div>
            </details>
          </div>

          <div className="min-w-0">
            <section
              aria-label="الكشف والتشخيص"
              className={activeTab === 'exam' ? 'space-y-4' : 'hidden'}
              onChange={() => setDirty(true)}
            >
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-cyan-700" />
                <h2 className="font-black">العلامات الحيوية</h2>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ['الضغط', bloodPressure, setBloodPressure, '120/80'],
                  ['الحرارة', temperature, setTemperature, '37'],
                  ['النبض', pulse, setPulse, '72'],
                  ['الوزن', weight, setWeight, 'kg'],
                  ['SpO₂', oxygenSaturation, setOxygenSaturation, '98%'],
                ].map(([label, value, setter, placeholder]) => (
                  <label key={String(label)} className="grid gap-1">
                    <span className="text-xs font-bold text-slate-600">{String(label)}</span>
                    <input
                      disabled={!canEdit}
                      value={String(value)}
                      onChange={(e) => (setter as (value: string) => void)(e.target.value)}
                      placeholder={String(placeholder)}
                      className="rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50"
                      dir="ltr"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-cyan-700" />
                <h2 className="font-black">الكشف والتشخيص</h2>
              </div>
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1">
                  <span className="text-xs font-bold text-slate-600">Clinical notes</span>
                  <textarea disabled={!canEdit} value={clinicalNotes} onChange={(e) => setClinicalNotes(e.target.value)} rows={5} className="rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" placeholder="الفحص، الملاحظات والنتائج…" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-bold text-slate-600">ملخص التشخيص</span>
                  <textarea disabled={!canEdit} value={diagnosisSummary} onChange={(e) => setDiagnosisSummary(e.target.value)} rows={3} className="rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" placeholder="التشخيص يكتبه الطبيب المسؤول فقط" />
                </label>
                <p className="text-xs leading-6 text-slate-500">
                  اكتب ملاحظات الكشف والتشخيص، وبعدها احفظ المسودة أو راجع خطوة المتابعة قبل إنهاء الزيارة.
                </p>
              </div>
            </div>

            </section>

            <section aria-label="الروشتة الطبية" className={activeTab === 'prescription' ? 'space-y-4' : 'hidden'}>
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Pill className="h-5 w-5 text-violet-700" />
                <h2 className="font-black">الروشتة</h2>
              </div>

              {canEdit && (
                <div className="mt-4 space-y-3">
                  {rxItems.map((item, index) => (
                    <div key={index} className="rounded-2xl border bg-slate-50 p-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        <input value={item.medicationName} onChange={(e) => updateRx(index, 'medicationName', e.target.value)} placeholder="اسم الدواء *" className="rounded-xl border bg-white px-3 py-2 text-sm" />
                        <input value={item.strength} onChange={(e) => updateRx(index, 'strength', e.target.value)} placeholder="التركيز" className="rounded-xl border bg-white px-3 py-2 text-sm" />
                        <input value={item.dosage} onChange={(e) => updateRx(index, 'dosage', e.target.value)} placeholder="الجرعة" className="rounded-xl border bg-white px-3 py-2 text-sm" />
                        <input value={item.frequency} onChange={(e) => updateRx(index, 'frequency', e.target.value)} placeholder="التكرار" className="rounded-xl border bg-white px-3 py-2 text-sm" />
                        <input value={item.duration} onChange={(e) => updateRx(index, 'duration', e.target.value)} placeholder="المدة" className="rounded-xl border bg-white px-3 py-2 text-sm" />
                        <input value={item.route} onChange={(e) => updateRx(index, 'route', e.target.value)} placeholder="طريقة الاستخدام" className="rounded-xl border bg-white px-3 py-2 text-sm" />
                      </div>
                      <div className="mt-2 flex gap-2">
                        <input value={item.instructions} onChange={(e) => updateRx(index, 'instructions', e.target.value)} placeholder="تعليمات إضافية" className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 text-sm" />
                        {rxItems.length > 1 && (
                          <button type="button" onClick={() => setRxItems((rows) => rows.filter((_, i) => i !== index))} className="rounded-xl border bg-white p-2 text-rose-600">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={() => setRxItems((rows) => [...rows, { ...EMPTY_RX }])} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold">
                    <Plus className="h-4 w-4" /> دواء آخر
                  </button>
                  <textarea value={rxNotes} onChange={(e) => setRxNotes(e.target.value)} rows={2} placeholder="ملاحظات الروشتة" className="w-full rounded-xl border px-3 py-2 text-sm" />
                  <button disabled={busy} type="button" onClick={() => void createPrescription()} className="inline-flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
                    <ClipboardPlus className="h-4 w-4" /> إنشاء مسودة روشتة
                  </button>
                </div>
              )}

              <div className="mt-5 rounded-xl border border-dashed border-cyan-200 bg-cyan-50/50 p-3 text-xs leading-6 text-cyan-900">
                إنشاء مسودة الروشتة يحفظ الأدوية فقط، ومش بيحفظ ملاحظات الكشف غير لما تضغط «حفظ المسودة» تحت.
                والطباعة متاحة للروشتات الموقعة فقط.
              </div>
              <div className="mt-5 space-y-3">
                {prescriptions.length === 0 && (
                  <div className="rounded-2xl border border-dashed p-4 text-xs text-slate-500">لا توجد روشتات في الزيارة حتى الآن.</div>
                )}
                {prescriptions.map((rx) => (
                  <article key={rx.PrescriptionId} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-black">روشتة</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {rx.Status === 'signed' ? 'موقعة' : rx.Status === 'void' ? 'ملغاة' : 'مسودة'} • {String(rx.CreatedAt).slice(0, 16).replace('T', ' ')}
                        </div>
                      </div>
                      {rx.Status === 'draft' && canClinicalAct && (
                        <button disabled={busy} type="button" onClick={() => void signPrescription(rx.PrescriptionId)} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
                          توقيع الروشتة
                        </button>
                      )}
                    </div>
                    <div className="mt-3 space-y-2">
                      {rx.items.map((item) => (
                        <div key={item.PrescriptionItemId} className="rounded-xl bg-slate-50 p-3 text-sm">
                          <strong>{item.MedicationName}</strong>
                          <div className="mt-1 text-xs leading-6 text-slate-600">
                            {[item.Strength, item.Dosage, item.Frequency, item.Duration, item.Route]
                              .filter(Boolean)
                              .join(' • ') || '—'}
                            {item.Instructions ? <div>{item.Instructions}</div> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    {rx.Notes && <div className="mt-3 text-xs text-slate-600">{rx.Notes}</div>}
                  </article>
                ))}
              </div>
            </div>
            </section>

            <section aria-label="المتابعة وإنهاء الزيارة" className={activeTab === 'follow_up' ? 'space-y-4' : 'hidden'} onChange={() => setDirty(true)}>
              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-cyan-700" />
                  <h2 className="font-black">المتابعة وإنهاء الكشف</h2>
                </div>
                <p className="mt-2 text-xs leading-6 text-slate-500">
                  متابعة المريض اختيارية. لإكمال الزيارة لازم يكون فيه تشخيص مسجّل بواسطة الطبيب المسؤول.
                </p>
                <label className="mt-5 grid max-w-md gap-2">
                  <span className="text-xs font-bold text-slate-600">موعد متابعة مقترح</span>
                  <input disabled={!canEdit} type="datetime-local" value={followUpAt}
                    onChange={(e) => setFollowUpAt(e.target.value)}
                    className="rounded-xl border bg-white px-3 py-2.5 text-sm disabled:bg-slate-50" />
                </label>
                <div className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                  <p className="font-black">مراجعة سريعة</p>
                  <p>✓ المريض: {encounter.PatientName}</p>
                  <p>✓ الطبيب: د. {encounter.PractitionerName}</p>
                  <p className={diagnosisSummary.trim() ? 'text-emerald-700' : 'text-amber-700'}>
                    {diagnosisSummary.trim() ? '✓ التشخيص مكتوب' : '• التشخيص مطلوب لإكمال الزيارة'}
                  </p>
                  <p>• الروشتة اختيارية — {prescriptions.length} مسودة / روشتة مسجلة</p>
                  <p className="text-xs text-slate-500">الحسابات والدفع بتتم من Shared POS في مرحلة مستقلة.</p>
                </div>
              </div>
            </section>
          </div>
        </section>
        {canEdit && (
          <footer className="sticky bottom-2 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:px-5">
            <div className="text-xs text-slate-500" aria-live="polite">
              {dirty ? 'تعديلات الكشف لم تُحفظ بعد' : 'احفظ أي تعديلات قبل مغادرة الزيارة'}
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} type="button" onClick={() => void saveEncounter('save')}
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-bold disabled:opacity-40">
                <Save className="h-4 w-4" /> حفظ المسودة
              </button>
              <button disabled={busy} type="button" onClick={() => {
                if (activeTab !== 'follow_up') { setActiveTab('follow_up'); return; }
                void saveEncounter('complete');
              }} className="inline-flex items-center gap-2 rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
                <CheckCircle2 className="h-4 w-4" /> {activeTab === 'follow_up' ? 'إكمال الزيارة' : 'مراجعة وإنهاء'}
              </button>
            </div>
          </footer>
        )}
      </div>

      {signedPrescriptions.length > 0 && canClinicalAct && (
        <section aria-label="نسخة طباعة الروشتة" className="hidden print:block">
          {signedPrescriptions.map((rx) => (
            <article key={rx.PrescriptionId} className="mx-auto w-full max-w-3xl bg-white px-8 py-8 text-black"
              style={{ breakAfter: 'page' }}>
              <header className="border-b-2 border-slate-900 pb-5 text-center">
                <h1 className="text-2xl font-bold">روشتة طبية — DRVO Clinics</h1>
                <p className="mt-2 text-sm">د. {encounter.PractitionerName}</p>
              </header>
              <div className="mt-5 flex justify-between gap-4 text-sm">
                <span>المريض: <strong>{encounter.PatientName}</strong></span>
                <span>تاريخ الاعتماد: {rx.SignedAt ? new Date(rx.SignedAt).toLocaleDateString('ar-EG') : '—'}</span>
              </div>
              <div className="mt-8 min-h-[450px]">
                <h2 className="font-serif text-2xl">Rx</h2>
                <ol className="mt-5 space-y-5">
                  {rx.items.map((item) => (
                    <li key={item.PrescriptionItemId} className="border-b border-slate-200 pb-4">
                      <strong className="text-base">{item.MedicationName} {item.Strength || ''}</strong>
                      <p className="mt-2 text-sm">
                        {[item.Dosage, item.Frequency, item.Duration, item.Route].filter(Boolean).join(' • ')}
                      </p>
                      {item.Instructions && <p className="mt-1 text-sm">{item.Instructions}</p>}
                    </li>
                  ))}
                </ol>
                {rx.Notes && <p className="mt-6 text-sm">تعليمات الطبيب: {rx.Notes}</p>}
              </div>
              <footer className="mt-5 border-t border-slate-900 pt-4 text-sm">
                تم اعتماد الروشتة إلكترونيًا بواسطة الطبيب المسؤول
              </footer>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
