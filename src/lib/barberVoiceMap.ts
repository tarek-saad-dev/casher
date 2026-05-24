/**
 * Barber voice mapping for announcements
 * Maps Arabic barber names to English transliteration for TTS
 * and assigns chair numbers
 */

export interface BarberVoiceInfo {
  chairNumber: number;
  englishName: string;
}

export const BARBER_VOICE_MAP: Record<string, BarberVoiceInfo> = {
  "كريم": {
    chairNumber: 1,
    englishName: "Kareem"
  },
  "محمد": {
    chairNumber: 2,
    englishName: "Mohamed"
  },
  "باسم": {
    chairNumber: 3,
    englishName: "Bassem"
  },
  "أحمد": {
    chairNumber: 4,
    englishName: "Ahmed"
  },
  "احمد": {
    chairNumber: 4,
    englishName: "Ahmed"
  },
  "ذياد": {
    chairNumber: 5,
    englishName: "Ziad"
  },
  "زياد": {
    chairNumber: 5,
    englishName: "Ziad"
  },
  "عمر": {
    chairNumber: 6,
    englishName: "Omar"
  }
};

/**
 * Get barber voice info (chair number + English name) by Arabic name
 */
export function getBarberVoiceInfo(empName: string | null | undefined): BarberVoiceInfo | null {
  if (!empName) return null;

  const trimmedName = empName.trim();

  // Direct lookup
  const info = BARBER_VOICE_MAP[trimmedName];
  if (info) return info;

  // Try case-insensitive lookup
  const normalizedName = trimmedName.toLowerCase();
  for (const [name, data] of Object.entries(BARBER_VOICE_MAP)) {
    if (name.toLowerCase() === normalizedName) {
      return data;
    }
  }

  // Try partial match (in case of compound names like "أحمد علي" vs "أحمد")
  for (const [name, data] of Object.entries(BARBER_VOICE_MAP)) {
    if (normalizedName.includes(name.toLowerCase()) ||
        name.toLowerCase().includes(normalizedName)) {
      return data;
    }
  }

  return null;
}

/**
 * Get chair number only (for Arabic announcements and display)
 */
export function getChairNumber(empName: string | null | undefined): number | null {
  const info = getBarberVoiceInfo(empName);
  return info?.chairNumber ?? null;
}

/**
 * Get English name only (for English TTS announcements)
 */
export function getEnglishBarberName(empName: string | null | undefined): string | null {
  const info = getBarberVoiceInfo(empName);
  return info?.englishName ?? null;
}

/**
 * Get display text for chair (Arabic)
 */
export function getChairDisplayText(empName: string | null | undefined): string {
  const chairNumber = getChairNumber(empName);
  if (chairNumber) {
    return `كرسي ${chairNumber}`;
  }
  return '';
}
