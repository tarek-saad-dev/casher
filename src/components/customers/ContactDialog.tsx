'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { resultLabel } from '@/lib/customerFollowUpValidation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Employee { EmpID: number; EmpName: string; }

export interface FollowUpData {
  isContacted:         boolean;
  resultType:          string;
  complaintType:       string | null;
  complaintEmpId:      number | null;
  complaintEmpName:    string | null;
  reasonText:          string | null;
  notes:               string | null;
  contactedAt:         string;
  contactedByUserId:   number | null;
  contactedByUserName: string | null;
}

interface CustomerInfo {
  clientId:    number;
  name:        string;
  phone:       string | null;
  mobile:      string | null;
  lastVisit:   string;
  inactiveDays: number;
}

interface Props {
  open:            boolean;
  customer:        CustomerInfo | null;
  followUpMonth:   string;          // "YYYY-MM"
  existingFollowUp: FollowUpData | null;
  onClose:         () => void;
  onSaved:         (clientId: number, followUp: FollowUpData) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(val: string | null | undefined): string {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleDateString('ar-EG', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return val; }
}

function formatDateTime(val: string | null | undefined): string {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleString('ar-EG', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return val; }
}

// ── Result type options ───────────────────────────────────────────────────────

const RESULT_OPTIONS = [
  { value: 'outside_governorate', label: 'خارج المحافظة' },
  { value: 'outside_country',     label: 'خارج الدولة'   },
  { value: 'complaint',           label: 'شكوى'           },
  { value: 'other_reason',        label: 'سبب آخر'        },
];

const COMPLAINT_OPTIONS = [
  { value: 'barber',      label: 'من حلاق'    },
  { value: 'place',       label: 'من المكان'  },
  { value: 'cleanliness', label: 'من النظافة' },
  { value: 'other',       label: 'أخرى'       },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function ContactDialog({
  open, customer, followUpMonth, existingFollowUp, onClose, onSaved,
}: Props) {
  const [resultType,    setResultType]    = useState('');
  const [complaintType, setComplaintType] = useState('');
  const [complaintEmpId, setComplaintEmpId] = useState<number | ''>('');
  const [reasonText,    setReasonText]    = useState('');
  const [notes,         setNotes]         = useState('');

  const [employees,     setEmployees]     = useState<Employee[]>([]);
  const [loadingEmps,   setLoadingEmps]   = useState(false);

  const [saving,        setSaving]        = useState(false);
  const [errorMsg,      setErrorMsg]      = useState('');
  const [successMsg,    setSuccessMsg]    = useState('');

  // ── Prefill from existing record when opening ──────────────────────────────
  useEffect(() => {
    if (!open) return;
    setErrorMsg('');
    setSuccessMsg('');
    if (existingFollowUp) {
      setResultType(existingFollowUp.resultType);
      setComplaintType(existingFollowUp.complaintType ?? '');
      setComplaintEmpId(existingFollowUp.complaintEmpId ?? '');
      setReasonText(existingFollowUp.reasonText ?? '');
      setNotes(existingFollowUp.notes ?? '');
    } else {
      setResultType('');
      setComplaintType('');
      setComplaintEmpId('');
      setReasonText('');
      setNotes('');
    }
  }, [open, existingFollowUp]);

  // ── Load employees when complaint barber is chosen ────────────────────────
  useEffect(() => {
    if (resultType !== 'complaint' || complaintType !== 'barber') return;
    if (employees.length > 0) return; // already loaded
    setLoadingEmps(true);
    fetch('/api/employees')
      .then(r => r.json())
      .then((data: Employee[]) => setEmployees(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingEmps(false));
  }, [resultType, complaintType, employees.length]);

  // ── Reset dependent fields on result type change ──────────────────────────
  const handleResultTypeChange = useCallback((val: string) => {
    setResultType(val);
    if (val !== 'complaint') {
      setComplaintType('');
      setComplaintEmpId('');
    }
    setReasonText('');
    setErrorMsg('');
  }, []);

  const handleComplaintTypeChange = useCallback((val: string) => {
    setComplaintType(val);
    setComplaintEmpId('');
    setReasonText('');
    setErrorMsg('');
  }, []);

  // ── Client-side validation ────────────────────────────────────────────────
  function clientValidate(): string | null {
    if (!resultType) return 'نتيجة التواصل مطلوبة';
    if (resultType === 'complaint') {
      if (!complaintType) return 'تصنيف الشكوى مطلوب';
      if (!reasonText.trim()) return 'وصف الشكوى مطلوب';
    }
    if (resultType === 'other_reason' && !reasonText.trim()) return 'السبب مطلوب';
    return null;
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const validErr = clientValidate();
    if (validErr) { setErrorMsg(validErr); return; }
    if (!customer) return;

    setSaving(true);
    try {
      const res = await fetch('/api/admin/customers/follow-up/contact', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId:      customer.clientId,
          followUpMonth,
          resultType,
          complaintType:  resultType === 'complaint' ? complaintType : null,
          complaintEmpId: (resultType === 'complaint' && complaintType === 'barber' && complaintEmpId)
            ? Number(complaintEmpId) : null,
          reasonText: reasonText.trim() || null,
          notes:      notes.trim() || null,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrorMsg(json.error || 'حدث خطأ أثناء الحفظ');
        return;
      }

      setSuccessMsg('تم الحفظ بنجاح');
      onSaved(customer.clientId, json.followUp as FollowUpData);

      setTimeout(() => { onClose(); }, 900);

    } catch {
      setErrorMsg('تعذّر الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  }

  if (!open || !customer) return null;

  const needsReason = resultType === 'other_reason'
    || (resultType === 'complaint' && !!complaintType);
  const reasonRequired = resultType === 'other_reason'
    || (resultType === 'complaint');
  const reasonLabel = resultType === 'other_reason'
    ? 'اذكر السبب'
    : (complaintType === 'other' ? 'اذكر سبب الشكوى بالتفصيل' : 'وصف الشكوى');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      dir="rtl"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg bg-zinc-900 border border-zinc-700/60 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-base font-semibold text-white">تسجيل نتيجة التواصل</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Customer info */}
        <div className="px-5 py-3 bg-zinc-800/40 border-b border-zinc-800 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          <div>
            <span className="text-zinc-500">الاسم: </span>
            <span className="text-zinc-200 font-medium">{customer.name}</span>
          </div>
          <div dir="ltr" className="text-right">
            <span className="text-zinc-500">الهاتف: </span>
            <span className="text-zinc-200 font-mono">{customer.mobile || customer.phone || '—'}</span>
          </div>
          <div>
            <span className="text-zinc-500">آخر زيارة: </span>
            <span className="text-zinc-400">{formatDate(customer.lastVisit)}</span>
          </div>
          <div>
            <span className="text-zinc-500">مدة الغياب: </span>
            <span className="text-amber-400 font-medium">{customer.inactiveDays} يوم</span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">

          {/* Result type */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              نتيجة التواصل <span className="text-rose-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {RESULT_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => handleResultTypeChange(o.value)}
                  className={`px-3 py-2 rounded-xl text-sm font-medium border text-right transition-colors ${
                    resultType === o.value
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                      : 'bg-zinc-800/50 text-zinc-400 border-zinc-700/40 hover:border-zinc-600/60 hover:text-zinc-200'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Complaint type */}
          {resultType === 'complaint' && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                تصنيف الشكوى <span className="text-rose-400">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {COMPLAINT_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => handleComplaintTypeChange(o.value)}
                    className={`px-3 py-2 rounded-xl text-sm font-medium border text-right transition-colors ${
                      complaintType === o.value
                        ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                        : 'bg-zinc-800/50 text-zinc-400 border-zinc-700/40 hover:border-zinc-600/60 hover:text-zinc-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Barber selector */}
          {resultType === 'complaint' && complaintType === 'barber' && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                اختر الحلاق <span className="text-zinc-600 font-normal">(اختياري)</span>
              </label>
              {loadingEmps ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>جاري تحميل الموظفين...</span>
                </div>
              ) : (
                <select
                  value={complaintEmpId}
                  onChange={e => setComplaintEmpId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-zinc-800 border border-zinc-700/50 rounded-xl px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 transition-colors"
                >
                  <option value="">— لا يوجد تحديد —</option>
                  {employees.map(emp => (
                    <option key={emp.EmpID} value={emp.EmpID}>{emp.EmpName}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Reason text */}
          {(needsReason) && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                {reasonLabel}
                {reasonRequired && <span className="text-rose-400"> *</span>}
              </label>
              <textarea
                value={reasonText}
                onChange={e => setReasonText(e.target.value)}
                rows={3}
                placeholder={resultType === 'other_reason' ? 'اذكر السبب بالتفصيل...' : 'اكتب وصف الشكوى...'}
                className="w-full bg-zinc-800 border border-zinc-700/50 rounded-xl px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-500 transition-colors"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              ملاحظات إضافية <span className="text-zinc-600 font-normal">(اختياري)</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="ملاحظات..."
              className="w-full bg-zinc-800 border border-zinc-700/50 rounded-xl px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          {/* Error / Success */}
          {errorMsg && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-900 font-semibold text-sm transition-colors"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              حفظ نتيجة التواصل
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-sm border border-zinc-700/40 transition-colors disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        </form>

        {/* Existing record footer — show who last recorded */}
        {existingFollowUp && !successMsg && (
          <div className="px-5 py-3 border-t border-zinc-800 text-xs text-zinc-600">
            آخر تسجيل: {existingFollowUp.contactedByUserName || '—'} — {formatDateTime(existingFollowUp.contactedAt)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Compact badge for table display ──────────────────────────────────────────

export function FollowUpBadge({ fu }: { fu: FollowUpData }) {
  const label = resultLabel(fu.resultType, fu.complaintType);
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 whitespace-nowrap">
      {label}
    </span>
  );
}

// ── Tooltip / popover for full details ───────────────────────────────────────

export function FollowUpDetailPopover({ fu }: { fu: FollowUpData }) {
  const [show, setShow] = useState(false);
  const label = resultLabel(fu.resultType, fu.complaintType);

  return (
    <div className="relative inline-block" dir="rtl">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        className="focus:outline-none"
        aria-label="تفاصيل التواصل"
      >
        <FollowUpBadge fu={fu} />
      </button>
      {show && (
        <div className="absolute right-0 top-7 z-20 w-60 bg-zinc-800 border border-zinc-700/60 rounded-xl shadow-xl p-3 text-xs space-y-1.5 pointer-events-none">
          <p className="font-semibold text-zinc-200">{label}</p>
          {fu.reasonText && (
            <p className="text-zinc-400"><span className="text-zinc-500">السبب: </span>{fu.reasonText}</p>
          )}
          {fu.notes && (
            <p className="text-zinc-400"><span className="text-zinc-500">ملاحظات: </span>{fu.notes}</p>
          )}
          <p className="text-zinc-500">
            بواسطة: {fu.contactedByUserName || '—'}
          </p>
          <p className="text-zinc-500">
            {fu.contactedAt ? new Date(fu.contactedAt).toLocaleString('ar-EG', {
              year: 'numeric', month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
            }) : '—'}
          </p>
        </div>
      )}
    </div>
  );
}
