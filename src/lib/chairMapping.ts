/**
 * Barber chair mapping for voice announcements
 * Re-exports from barberVoiceMap for backward compatibility
 */

import { getBarberVoiceInfo, getEnglishBarberName } from './barberVoiceMap';

// Re-export functions from barberVoiceMap
export { getEnglishBarberName };

/**
 * Get chair number for a barber by name
 * Delegates to barberVoiceMap
 */
export function getChairNumber(empName: string | null | undefined): number | null {
  const info = getBarberVoiceInfo(empName);
  return info?.chairNumber ?? null;
}

/**
 * Build Arabic announcement with chair number
 */
export function buildArabicAnnouncement(params: {
  ticketCode: string;
  customerName: string | null;
  empName: string | null;
  chairNumber: number | null;
}): string {
  const { ticketCode, customerName, empName, chairNumber } = params;

  const hasCustomer = customerName && customerName.trim();
  const hasBarber = empName && empName.trim();
  const hasChair = chairNumber !== null;

  if (hasCustomer && hasBarber && hasChair) {
    return `عميلنا ${customerName}، صاحب الدور رقم ${ticketCode}، يتفضل يتوجه إلى الأستاذ ${empName}، كرسي رقم ${chairNumber}`;
  }

  if (hasCustomer && hasBarber && !hasChair) {
    return `عميلنا ${customerName}، صاحب الدور رقم ${ticketCode}، يتفضل يتوجه إلى الأستاذ ${empName}`;
  }

  if (!hasCustomer && hasBarber && hasChair) {
    return `عميلنا صاحب الدور رقم ${ticketCode}، يتفضل يتوجه إلى الأستاذ ${empName}، كرسي رقم ${chairNumber}`;
  }

  if (!hasCustomer && hasBarber && !hasChair) {
    return `عميلنا صاحب الدور رقم ${ticketCode}، يتفضل يتوجه إلى الأستاذ ${empName}`;
  }

  if (hasCustomer && !hasBarber && hasChair) {
    return `عميلنا ${customerName}، صاحب الدور رقم ${ticketCode}، يتفضل يتوجه إلى منطقة الخدمة، كرسي رقم ${chairNumber}`;
  }

  if (hasCustomer && !hasBarber && !hasChair) {
    return `عميلنا ${customerName}، صاحب الدور رقم ${ticketCode}، يتفضل يتوجه إلى منطقة الخدمة`;
  }

  if (!hasCustomer && !hasBarber && hasChair) {
    return `صاحب الدور رقم ${ticketCode}، يتفضل يتوجه إلى منطقة الخدمة، كرسي رقم ${chairNumber}`;
  }

  return `صاحب الدور رقم ${ticketCode}، يتفضل يتوجه إلى منطقة الخدمة`;
}

/**
 * Build English announcement with chair number
 * Uses English transliteration of barber names for TTS
 */
export function buildEnglishAnnouncement(params: {
  ticketCode: string;
  customerName: string | null;
  empName: string | null;
  chairNumber: number | null;
}): string {
  const { ticketCode, customerName, empName, chairNumber } = params;

  const hasCustomer = customerName && customerName.trim();
  // Get English name for TTS (Kareem, Mohamed, Bassem, Ahmed, Ziad, Omar)
  const englishBarberName = getEnglishBarberName(empName);
  const hasBarber = englishBarberName !== null;
  const hasChair = chairNumber !== null;

  if (hasCustomer && hasBarber && hasChair) {
    return `Ticket number ${ticketCode}, customer ${customerName}, please proceed to barber ${englishBarberName}, chair number ${chairNumber}`;
  }

  if (hasCustomer && hasBarber && !hasChair) {
    return `Ticket number ${ticketCode}, customer ${customerName}, please proceed to barber ${englishBarberName}`;
  }

  if (!hasCustomer && hasBarber && hasChair) {
    return `Ticket number ${ticketCode}, please proceed to barber ${englishBarberName}, chair number ${chairNumber}`;
  }

  if (!hasCustomer && hasBarber && !hasChair) {
    return `Ticket number ${ticketCode}, please proceed to barber ${englishBarberName}`;
  }

  // Fallback: use original empName if no mapping found
  if (hasCustomer && empName && hasChair) {
    return `Ticket number ${ticketCode}, customer ${customerName}, please proceed to barber ${empName}, chair number ${chairNumber}`;
  }

  if (hasCustomer && empName && !hasChair) {
    return `Ticket number ${ticketCode}, customer ${customerName}, please proceed to barber ${empName}`;
  }

  if (!hasCustomer && empName && hasChair) {
    return `Ticket number ${ticketCode}, please proceed to barber ${empName}, chair number ${chairNumber}`;
  }

  if (!hasCustomer && empName && !hasChair) {
    return `Ticket number ${ticketCode}, please proceed to barber ${empName}`;
  }

  if (hasCustomer && !hasBarber && hasChair) {
    return `Ticket number ${ticketCode}, customer ${customerName}, please proceed to the service area, chair number ${chairNumber}`;
  }

  if (hasCustomer && !hasBarber && !hasChair) {
    return `Ticket number ${ticketCode}, customer ${customerName}, please proceed to the service area`;
  }

  if (!hasCustomer && !hasBarber && hasChair) {
    return `Ticket number ${ticketCode}, please proceed to the service area, chair number ${chairNumber}`;
  }

  return `Ticket number ${ticketCode}, please proceed to the service area`;
}

/**
 * Build announcement sequence for voice playback
 * Arabic once, English once (no repetition)
 */
export interface AnnouncementPart {
  lang: 'ar-EG' | 'en-US';
  text: string;
  rate: string;
  pitch: string;
}

export function buildAnnouncementSequence(params: {
  ticketCode: string;
  customerName: string | null;
  empName: string | null;
}): AnnouncementPart[] {
  const { ticketCode, customerName, empName } = params;
  const chairNumber = getChairNumber(empName);

  const arabicText = buildArabicAnnouncement({
    ticketCode,
    customerName,
    empName,
    chairNumber,
  });

  const englishText = buildEnglishAnnouncement({
    ticketCode,
    customerName,
    empName,
    chairNumber,
  });

  // Return only 2 parts: Arabic once, English once
  return [
    {
      lang: 'ar-EG',
      text: arabicText,
      rate: '-5%',
      pitch: '0%',
    },
    {
      lang: 'en-US',
      text: englishText,
      rate: '-5%',
      pitch: '0%',
    },
  ];
}

/**
 * Get chair display text for UI
 */
export function getChairDisplayText(empName: string | null | undefined): string {
  const chairNumber = getChairNumber(empName);
  if (chairNumber) {
    return `كرسي ${chairNumber}`;
  }
  return '';
}
