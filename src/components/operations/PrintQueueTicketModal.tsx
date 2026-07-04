'use client';

import React, { useState } from 'react';
import type { CreateQueueResponse } from '@/lib/operationsQueueTypes';
import { printQueueTicket } from '@/lib/printQueueTicket';
import { createQueueResponseToPrintData } from '@/lib/quickQueueClient';
import { normalizeCustomersAhead } from '@/lib/queueCustomersAhead';

interface PrintQueueTicketModalProps {
  isOpen: boolean;
  ticket: CreateQueueResponse | null;
  onClose: () => void;
  onPrintComplete?: () => void;
}

export function PrintQueueTicketModal({
  isOpen,
  ticket,
  onClose,
  onPrintComplete,
}: PrintQueueTicketModalProps) {
  const [isPrinting, setIsPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  if (!isOpen || !ticket) return null;

  // Format time for display (12-hour format with AM/PM in Arabic)
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };
    return date.toLocaleDateString('ar-EG', options);
  };

  // Get customer display name
  const customerName = ticket.customer?.name || 'عميل مباشر';
  const customerPhone = ticket.customer?.phone || '';

  // Get chair display text
  const chairText = ticket.chairNumber ? `كرسي رقم ${ticket.chairNumber}` : '';

  // Get services list
  const servicesList = ticket.services.map(s => s.proName).join(' + ');

  const customersAhead = normalizeCustomersAhead(
    ticket.waitingCountAtCreation ?? ticket.peopleBefore,
  );

  // Handle print using existing printQueueTicket function
  const handlePrint = () => {
    setIsPrinting(true);
    setPrintError(null);

    try {
      const printData = createQueueResponseToPrintData(ticket);

      console.log('[PrintQueueTicketModal] printing ticket:', printData);
      
      // Use existing printQueueTicket function
      printQueueTicket(printData);
      
      onPrintComplete?.();
    } catch (err) {
      console.error('[PrintQueueTicketModal] print error:', err);
      setPrintError('فشل الطباعة. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4">
          <h2 className="text-xl font-bold text-white text-center">
            تذكرة الدور
          </h2>
        </div>

        {/* Ticket Preview */}
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {/* Thermal Receipt Container */}
          <div
            className="thermal-receipt bg-white border-2 border-gray-300 rounded-lg p-4 mx-auto"
            style={{ width: '72mm', maxWidth: '100%' }}
          >
            {/* Logo / Header */}
            <div className="text-center border-b-2 border-dashed border-gray-400 pb-3 mb-3">
              <h1 className="text-xl font-bold text-gray-900">CUT SALON</h1>
              <p className="text-sm text-gray-600 mt-1">تذكرة دور</p>
            </div>

            {/* Ticket Number - LARGE */}
            <div className="text-center py-4">
              <p className="text-sm text-gray-500 mb-1">رقم الدور</p>
              <p className="text-5xl font-bold text-gray-900 tracking-wider">
                {ticket.ticketCode}
              </p>
            </div>

            {/* Customer Info */}
            <div className="border-t-2 border-dashed border-gray-400 pt-3 mt-3">
              <div className="mb-2">
                <span className="text-xs text-gray-500">العميل</span>
                <p className="text-lg font-bold text-gray-900">{customerName}</p>
              </div>
              {customerPhone && (
                <div className="mb-2">
                  <span className="text-xs text-gray-500">الهاتف</span>
                  <p className="text-sm font-semibold text-gray-800">{customerPhone}</p>
                </div>
              )}
            </div>

            {/* Barber & Chair */}
            <div className="border-t border-dashed border-gray-400 pt-3 mt-3">
              <div className="flex justify-between items-center">
                <div>
                  <span className="text-xs text-gray-500">الحلاق</span>
                  <p className="text-base font-bold text-gray-900">{ticket.empName}</p>
                </div>
                {chairText && (
                  <div className="text-left">
                    <span className="text-xs text-gray-500">الكرسي</span>
                    <p className="text-lg font-bold text-gray-900">{ticket.chairNumber}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Services */}
            <div className="border-t border-dashed border-gray-400 pt-3 mt-3">
              <span className="text-xs text-gray-500">الخدمة</span>
              <p className="text-sm font-semibold text-gray-800">{servicesList}</p>
            </div>

            {/* Times */}
            <div className="border-t border-dashed border-gray-400 pt-3 mt-3">
              <div className="grid grid-cols-2 gap-2 text-center">
                <div>
                  <span className="text-xs text-gray-500 block">وقت الدخول</span>
                  <p className="text-base font-bold text-gray-900">{formatTime(ticket.estimatedStartTime)}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">وقت الانتهاء</span>
                  <p className="text-base font-bold text-gray-900">{formatTime(ticket.estimatedEndTime)}</p>
                </div>
              </div>
            </div>

            {/* Queue Info */}
            <div className="border-t border-dashed border-gray-400 pt-3 mt-3">
              <div className="text-center">
                <span className="text-xs text-gray-500">قدامك</span>
                <p className="text-xl font-bold text-gray-900">
                  {customersAhead} {customersAhead === 1 ? 'شخص' : 'أشخاص'}
                </p>
              </div>
            </div>

            {/* Date */}
            <div className="border-t border-dashed border-gray-400 pt-3 mt-3 text-center">
              <p className="text-xs text-gray-600">{formatDate(ticket.queueDate)}</p>
              <p className="text-xs text-gray-500 mt-1">
                وقت الإنشاء: {formatTime(ticket.createdAt)}
              </p>
            </div>

            {/* Footer Note */}
            <div className="border-t-2 border-dashed border-gray-400 pt-3 mt-3 text-center">
              <p className="text-xs text-gray-600 leading-relaxed">
                يرجى التواجد بالقرب من منطقة الانتظار عند اقتراب موعدك
              </p>
              <p className="text-xs text-gray-500 mt-2">
                شكراً لاختياركم Cut Salon
              </p>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {printError && (
          <div className="px-6 pb-2">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-600 text-center">{printError}</p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="p-6 border-t border-gray-200">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handlePrint}
              disabled={isPrinting}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
            >
              {isPrinting ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span>جاري الطباعة...</span>
                </>
              ) : (
                <>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                    />
                  </svg>
                  <span>طباعة</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              disabled={isPrinting}
              className="flex items-center justify-center gap-2 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 text-gray-800 font-semibold py-3 px-4 rounded-xl transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span>إغلاق</span>
            </button>
          </div>

          {/* Print Service Status */}
          <p className="text-xs text-gray-400 text-center mt-3">
            {isPrinting
              ? 'جاري محاولة الطباعة...'
              : 'سيتم استخدام خدمة الطباعة المحلية إذا كانت متاحة'}
          </p>
        </div>
      </div>

    </div>
  );
}
