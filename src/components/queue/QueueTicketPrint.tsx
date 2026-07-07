'use client';

import React from 'react';
import { normalizeCustomersAhead } from '@/lib/queueCustomersAhead';

export interface QueueTicketPrintData {
  ticketCode: string;
  clientName?: string | null;
  empName?: string | null;
  services?: { name: string; price?: number }[];
  queueDate?: string;
  createdTime?: string;
  waitingBefore?: number | null;
  estimatedWaitMinutes?: number | null;
  estimatedStartTime?: string | null;
  totalDurationMinutes?: number | null;
  estimatedEndTime?: string | null;
}

interface Props {
  data: QueueTicketPrintData;
  /** If true, renders visibly for preview (dev mode) */
  preview?: boolean;
}

const PRINT_CSS = `
  /* Screen: push the hidden print root far off-screen */
  @media screen {
    #queue-ticket-print-root {
      position: fixed !important;
      left: -10000px !important;
      top: 0 !important;
      width: 80mm !important;
      background: white !important;
      color: black !important;
      overflow: hidden !important;
      direction: rtl !important;
      z-index: -999 !important;
    }
  }

  /* Receipt layout — used for on-screen preview and the offscreen root */
  .queue-receipt {
    width: 80mm;
    max-width: 80mm;
    box-sizing: border-box;
    padding: 4mm 5mm 6mm;
    background: #fff;
    color: #000;
    font-family: Tahoma, Arial, 'Segoe UI', sans-serif;
    direction: rtl;
    text-align: center;
    overflow: hidden;
  }

  .queue-receipt .r-logo-wrap {
    text-align: center;
    margin-bottom: 3px;
  }

  .queue-receipt .r-salon-name {
    font-size: 13pt;
    font-weight: 900;
    letter-spacing: 1px;
    line-height: 1.2;
    margin-bottom: 1px;
    color: #000;
  }

  .queue-receipt .r-salon-sub {
    font-size: 8pt;
    color: #555;
    margin-bottom: 5px;
  }

  .queue-receipt .r-dashes {
    border: none;
    border-top: 1px dashed #888;
    margin: 5px 0;
    width: 100%;
  }

  .queue-receipt .r-ticket-label {
    font-size: 8pt;
    color: #555;
    letter-spacing: 1px;
    margin-bottom: 0;
    text-align: center;
  }

  .queue-receipt .r-ticket-code {
    font-size: 52pt;
    font-weight: 900;
    letter-spacing: -2px;
    line-height: 1.0;
    color: #000;
    text-align: center;
    margin: 2px 0 4px;
  }

  .queue-receipt .r-rows {
    text-align: right;
    margin: 3px 0;
  }

  .queue-receipt .r-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 6px;
    font-size: 9pt;
    line-height: 1.55;
    border-bottom: 1px dotted #ddd;
    padding: 1px 0;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .queue-receipt .r-row:last-child {
    border-bottom: none;
  }

  .queue-receipt .r-lbl {
    color: #555;
    font-size: 8pt;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .queue-receipt .r-val {
    font-weight: 700;
    color: #000;
    text-align: left;
    word-break: break-word;
  }

  .queue-receipt .r-footer {
    font-size: 8pt;
    color: #444;
    line-height: 1.7;
    text-align: center;
    margin-top: 4px;
  }

  .queue-receipt .r-brand {
    font-size: 7.5pt;
    color: #777;
    border-top: 1px solid #ccc;
    padding-top: 3px;
    margin-top: 4px;
    text-align: center;
  }
`;

export function QueueTicketPrint({ data, preview = false }: Props) {
  const {
    ticketCode,
    clientName,
    empName,
    services = [],
    queueDate,
    createdTime,
    waitingBefore,
    estimatedWaitMinutes,
    estimatedStartTime,
    totalDurationMinutes,
    estimatedEndTime,
  } = data;

  const dateLabel = queueDate
    ? new Date(queueDate).toLocaleDateString('ar-EG', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  const timeLabel = createdTime ? createdTime.slice(0, 5) : null;

  const estTimeLabel = estimatedStartTime
    ? (() => {
        const d = new Date(estimatedStartTime);
        const h = d.getHours() % 12 || 12;
        const m = String(d.getMinutes()).padStart(2, '0');
        const p = d.getHours() < 12 ? 'ص' : 'م';
        return `${h}:${m} ${p}`;
      })()
    : null;

  const estEndLabel = estimatedEndTime
    ? (() => {
        const d = new Date(estimatedEndTime);
        const h = d.getHours() % 12 || 12;
        const m = String(d.getMinutes()).padStart(2, '0');
        const p = d.getHours() < 12 ? 'ص' : 'م';
        return `${h}:${m} ${p}`;
      })()
    : null;

  const receipt = (
    <div className="queue-receipt">

      {/* ── Logo ── */}
      <div className="r-logo-wrap">
        <img
          src="/cutsalon.png"
          alt="Cut Salon"
          style={{ maxHeight: '16mm', maxWidth: '32mm', objectFit: 'contain' }}
          onError={e => {
            const el = e.target as HTMLImageElement;
            el.style.display = 'none';
          }}
        />
      </div>

      {/* ── Salon name ── */}
      <div className="r-salon-name">Cut Salon</div>
      <div className="r-salon-sub">صالون كَت للحلاقة</div>

      <hr className="r-dashes" />

      {/* ── Ticket number ── */}
      {!ticketCode ? (
        <div style={{ color: '#c00', fontSize: '9pt', padding: '4px 0' }}>
          لا توجد بيانات كافية للطباعة
        </div>
      ) : (
        <>
          <div className="r-ticket-label">رقم الانتظار</div>
          <div className="r-ticket-code">{ticketCode}</div>
        </>
      )}

      <hr className="r-dashes" />

      {/* ── Details rows ── */}
      <div className="r-rows">
        {clientName && (
          <div className="r-row">
            <span className="r-lbl">العميل</span>
            <span className="r-val">{clientName}</span>
          </div>
        )}
        {empName && (
          <div className="r-row">
            <span className="r-lbl">الحلاق</span>
            <span className="r-val">{empName}</span>
          </div>
        )}
        {services.length > 0 && (
          <div className="r-row">
            <span className="r-lbl">الخدمات</span>
            <span className="r-val">{services.map(s => s.name).join('، ')}</span>
          </div>
        )}
        {dateLabel && (
          <div className="r-row">
            <span className="r-lbl">التاريخ</span>
            <span className="r-val">{dateLabel}</span>
          </div>
        )}
        {timeLabel && (
          <div className="r-row">
            <span className="r-lbl">وقت الإصدار</span>
            <span className="r-val" dir="ltr">{timeLabel}</span>
          </div>
        )}
        {(() => {
          const customersAhead = normalizeCustomersAhead(waitingBefore);
          return (
            <div className="r-row">
              <span className="r-lbl">أمامك في الانتظار</span>
              <span className="r-val">{customersAhead}</span>
            </div>
          );
        })()}
        {estTimeLabel && (
          <div className="r-row">
            <span className="r-lbl">وقت الدخول المتوقع</span>
            <span className="r-val" dir="ltr">{estTimeLabel}</span>
          </div>
        )}
        {estEndLabel && (
          <div className="r-row">
            <span className="r-lbl">وقت الانتهاء المتوقع</span>
            <span className="r-val" dir="ltr">{estEndLabel}</span>
          </div>
        )}
        {totalDurationMinutes != null && totalDurationMinutes > 0 && (
          <div className="r-row">
            <span className="r-lbl">المدة</span>
            <span className="r-val">{totalDurationMinutes} دقيقة</span>
          </div>
        )}
        {estimatedWaitMinutes != null && estimatedWaitMinutes > 0 && (
          <div className="r-row">
            <span className="r-lbl">انتظار تقريبي</span>
            <span className="r-val">~{estimatedWaitMinutes} د</span>
          </div>
        )}
      </div>

      <hr className="r-dashes" />

      {/* ── Footer ── */}
      <div className="r-footer">
        <div>برجاء الاحتفاظ برقم الدور</div>
        <div>سيتم النداء عليك عند اقتراب موعدك</div>
      </div>
      <div className="r-brand">شكراً لاختياركم Cut Salon ✂</div>

    </div>
  );

  if (preview) {
    return (
      <div style={{
        display: 'inline-block',
        border: '1px solid #ccc',
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        borderRadius: 4,
        background: '#fff',
      }}>
        <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
        {receipt}
      </div>
    );
  }

  return (
    <div id="queue-ticket-print-root">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      {receipt}
    </div>
  );
}
