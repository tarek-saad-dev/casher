export const BOOKING_MANAGEMENT_OPERATIONS = ['CANCEL', 'MODIFY'] as const;
export type BookingManagementOperation = (typeof BOOKING_MANAGEMENT_OPERATIONS)[number];

export const BOOKING_MANAGEMENT_STAGES = [
  'RESOLVING_BOOKING',
  'COLLECTING_CHANGE',
  'VALIDATING',
  'CHOOSING_ALTERNATIVE',
  'READY_TO_CONFIRM',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'ABANDONED',
] as const;
export type BookingManagementStage = (typeof BOOKING_MANAGEMENT_STAGES)[number];

export type UpcomingBookingSummary = {
  bookingId: number | null;
  bookingCode: string;
  branchName: string | null;
  branchCode: string | null;
  employeeName: string | null;
  empId: number | null;
  workDate: string | null;
  time: string | null;
  endDateTime: string | null;
  servicesSummary: string | null;
  serviceIds?: number[] | null;
  status: string;
  canCancel: boolean;
};

export type DesiredBookingChanges = {
  date?: string | null;
  time?: string | null;
  empId?: number | null;
  employeeName?: string | null;
  branchId?: number | null;
  branchCode?: string | null;
  serviceIds?: number[] | null;
};

export type BookingManagementPlanSnapshot = {
  planId: number;
  conversationId: number;
  version: number;
  operation: BookingManagementOperation;
  stage: BookingManagementStage;
  targetBookingId: number | null;
  targetBookingCode: string | null;
  originalSnapshot: UpcomingBookingSummary | null;
  desiredChanges: DesiredBookingChanges;
  validatedDesiredState: Record<string, unknown> | null;
  candidateAlternatives: unknown[];
  confirmationVersion: number;
  idempotencyKey: string | null;
  lastTurnId: number | null;
};

export type LastRelevantBooking = {
  bookingId: number | null;
  bookingCode: string;
  snapshot: UpcomingBookingSummary;
  lastReferencedAt: string;
};

export type PendingBookingSelection = {
  expectedAnswerType: 'BOOKING_SELECTION';
  candidateBookingCodes: string[];
  askedAt: string;
};

export const BANNED_ADDRESS_TERMS = [
  'يا باشا',
  'يا معلم',
  'يا كبير',
  'يا نجم',
  'يا ريس',
  'يا حاج',
] as const;

export const FAKE_PROGRESS_PATTERNS = [
  /جاري\s*(إلغاء|تعديل|تنفيذ)/i,
  /هعدل\s*الحجز/i,
  /السيستم\s*(بيأكد|مش\s*سامح)/i,
] as const;

export function assertSafeCustomerCopy(text: string): void {
  const lower = text.toLowerCase();
  for (const term of BANNED_ADDRESS_TERMS) {
    if (text.includes(term)) {
      throw new Error(`banned_address_term:${term}`);
    }
  }
  for (const re of FAKE_PROGRESS_PATTERNS) {
    if (re.test(lower) || re.test(text)) {
      throw new Error(`fake_progress_wording:${re.source}`);
    }
  }
}

export function buildManagementIdempotencyKey(input: {
  conversationId: number;
  planId: number;
  confirmationVersion: number;
}): string {
  return `booking-management:${input.conversationId}:${input.planId}:v${input.confirmationVersion}`;
}
