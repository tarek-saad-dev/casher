'use client';

import { useState, useEffect, useCallback } from 'react';
import { Printer, Volume2, VolumeX, Plus, X, Ticket, CheckCircle2, Eye } from 'lucide-react';
import { QueueTicketPrint, type QueueTicketPrintData } from './QueueTicketPrint';
import { printQueueTicket } from '@/lib/printQueueTicket';
import { speakQueueTicket, stopQueueSpeech } from '@/lib/queueVoice';
import type { QueueVoiceOptions } from '@/lib/queueVoice';

export interface QueueTicketCreatedModalProps {
  data: QueueTicketPrintData & {
    ticketId: number;
  };
  onNewTicket: () => void;
  onClose: () => void;
}

export function QueueTicketCreatedModal({
  data,
  onNewTicket,
  onClose,
}: QueueTicketCreatedModalProps) {
  const [speaking,     setSpeaking]     = useState(false);
  const [printing,     setPrinting]     = useState(false);
  const [speechError,  setSpeechError]  = useState<string | null>(null);
  const [toastMsg,     setToastMsg]     = useState<string | null>(null);
  const [showPreview,  setShowPreview]  = useState(false);

  // Show speech-unsupported toast helper
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  // Stop speech when modal unmounts
  useEffect(() => () => { stopQueueSpeech(); }, []);

  const handlePrint = useCallback(() => {
    if (printing) return;
    setPrinting(true);
    printQueueTicket(data);
    // Record print on server (non-blocking)
    fetch(`/api/queue/${data.ticketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incrementPrintCount: true }),
    }).catch(() => {});
    // Re-enable after short delay to prevent rapid double-clicks
    setTimeout(() => setPrinting(false), 2000);
  }, [printing, data]);

  const handleSpeak = async () => {
    setSpeechError(null);
    setSpeaking(true);
    try {
      const opts: QueueVoiceOptions = { provider: 'azure' };
      await speakQueueTicket({
        ticketCode: data.ticketCode,
        clientName: data.clientName,
        empName:    data.empName,
      }, opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'NO_SPEECH_SYNTHESIS' || msg === 'BOTH_FAILED') {
        showToast('تعذر تشغيل النداء الصوتي');
      } else {
        setSpeechError('تعذر تشغيل النداء الصوتي الاحترافي');
      }
    } finally {
      setSpeaking(false);
    }
  };

  const handleStopSpeak = () => {
    stopQueueSpeech();
    setSpeaking(false);
  };

  const dateLabel = data.queueDate
    ? new Date(data.queueDate).toLocaleDateString('ar-EG', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <>
      {/* Hidden printable ticket — always mounted while modal is open */}
      <QueueTicketPrint data={data} />

      {/* Modal backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="relative rounded-2xl border shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
          style={{ background: '#141418', borderColor: '#2A2A35' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-3 left-3 p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all z-10"
          >
            <X size={15} />
          </button>

          {/* Header band */}
          <div
            className="px-6 pt-6 pb-4 text-center"
            style={{ background: 'linear-gradient(135deg, rgba(214,168,79,0.12), rgba(184,146,58,0.06))' }}
          >
            <div className="flex items-center justify-center gap-2 mb-3">
              <CheckCircle2 size={18} className="text-emerald-400" />
              <span className="text-sm font-bold text-emerald-400">تم إنشاء التذكرة</span>
            </div>

            {/* Big ticket code */}
            <div
              className="text-7xl font-black tracking-tight leading-none mb-1"
              style={{ color: '#D6A84F', textShadow: '0 0 40px rgba(214,168,79,0.45)' }}
            >
              {data.ticketCode}
            </div>
            <div className="text-xs text-zinc-500">رقم الانتظار</div>
          </div>

          {/* Details */}
          <div className="px-6 py-4 space-y-2 border-b border-zinc-800">
            {data.clientName && (
              <Row label="العميل" value={data.clientName} />
            )}
            {data.empName && (
              <Row label="الحلاق" value={data.empName} />
            )}
            {data.services && data.services.length > 0 && (
              <Row
                label="الخدمات"
                value={data.services.map(s => s.name).join('، ')}
              />
            )}
            {dateLabel && <Row label="التاريخ" value={dateLabel} />}
            {data.createdTime && (
              <Row label="الوقت" value={data.createdTime.slice(0, 5)} />
            )}
            {data.waitingBefore != null && data.waitingBefore > 0 && (
              <Row label="أمامك في الانتظار" value={`${data.waitingBefore} عميل`} />
            )}
            {data.estimatedWaitMinutes != null && data.estimatedWaitMinutes > 0 && (
              <Row label="الوقت التقديري" value={`~${data.estimatedWaitMinutes} دقيقة`} />
            )}
          </div>

          {/* Footer message */}
          <div className="px-6 py-3 text-center text-[11px] text-zinc-500 border-b border-zinc-800">
            احتفظ برقمك حتى يتم النداء عليك
          </div>

          {/* Print tip */}
          <div className="px-5 py-2 text-center border-b border-zinc-800 space-y-1">
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              💡 <span className="text-zinc-400">Margins = None</span> · ألغِ <span className="text-zinc-400">Headers &amp; footers</span>
            </p>
            <p className="text-[10px] text-zinc-600 leading-relaxed">
              المقاس المقترح: <span className="text-zinc-400">80mm × 110mm</span> · لا تستخدم 80×3276mm
            </p>
          </div>

          {/* Action buttons */}
          <div className="p-4 space-y-2">
            {/* Row 1: Print + Preview */}
            <div className="flex gap-2">
              <button
                onClick={handlePrint}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all hover:bg-zinc-800"
                style={{ borderColor: '#3A3A45', color: '#D1D5DB' }}
              >
                <Printer size={15} />
                طباعة
              </button>
              <button
                onClick={() => setShowPreview(true)}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all hover:bg-zinc-800"
                style={{ borderColor: '#3A3A45', color: '#9CA3AF' }}
              >
                <Eye size={13} />
                معاينة
              </button>
            </div>

            {/* Row 2: Voice */}
            <div className="flex gap-2">

              {speaking ? (
                <button
                  onClick={handleStopSpeak}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all"
                  style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#EF4444', background: 'rgba(239,68,68,0.08)' }}
                >
                  <VolumeX size={15} />
                  إيقاف
                </button>
              ) : (
                <button
                  onClick={handleSpeak}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all hover:bg-zinc-800"
                  style={{ borderColor: 'rgba(59,130,246,0.4)', color: '#60A5FA', background: 'rgba(59,130,246,0.06)' }}
                >
                  <Volume2 size={15} />
                  نداء الآن
                </button>
              )}
            </div>

            {speechError && (
              <p className="text-xs text-red-400 text-center">{speechError}</p>
            )}

            {/* Row 2: New + Close */}
            <div className="flex gap-2">
              <button
                onClick={onNewTicket}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{ background: 'linear-gradient(135deg,#D6A84F,#B8923A)', color: '#000' }}
              >
                <Plus size={15} />
                رقم جديد
              </button>
              <button
                onClick={onClose}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all hover:bg-zinc-800"
                style={{ borderColor: '#3A3A45', color: '#9CA3AF' }}
              >
                <Ticket size={15} />
                لوحة الانتظار
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toastMsg && (
        <div
          className="fixed bottom-6 right-1/2 translate-x-1/2 z-[60] px-5 py-3 rounded-xl text-sm font-semibold shadow-xl"
          style={{ background: '#1F2937', color: '#F9FAFB', border: '1px solid #374151' }}
        >
          {toastMsg}
        </div>
      )}

      {/* Preview overlay */}
      {showPreview && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80"
          onClick={() => setShowPreview(false)}
        >
          <div onClick={e => e.stopPropagation()} className="relative">
            <button
              onClick={() => setShowPreview(false)}
              className="absolute -top-8 left-0 text-white text-xs px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 no-print"
            >
              ✕ إغلاق المعاينة
            </button>
            <QueueTicketPrint data={data} preview={true} />
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-zinc-500 text-xs shrink-0">{label}</span>
      <span className="text-white font-medium text-right text-xs leading-relaxed">{value}</span>
    </div>
  );
}
