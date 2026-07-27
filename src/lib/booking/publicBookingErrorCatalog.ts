/**
 * Public-safe booking error catalog (Booking Phase 1 contract).
 */
import { NextResponse } from 'next/server';
import {
  withPublicBookingCors,
  type PublicBookingCorsMethod,
} from '@/lib/booking/publicBookingCors';

export type PublicBookingErrorCode =
  | 'BRANCH_REQUIRED'
  | 'BRANCH_NOT_FOUND'
  | 'BRANCH_NOT_PUBLIC'
  | 'BRANCH_BOOKING_DISABLED'
  | 'INVALID_BRANCH_CODE'
  | 'BRANCH_CLOSED_ON_WORKDATE'
  | 'BARBER_NOT_ASSIGNED'
  | 'BARBER_DAY_OFF'
  | 'BARBER_AVAILABLE_AT_DIFFERENT_BRANCH'
  | 'BARBER_FULLY_BOOKED'
  | 'SERVICE_NOT_AVAILABLE_AT_BRANCH'
  | 'BARBER_CANNOT_PERFORM_SERVICE'
  | 'INVALID_DAY_OFFSET'
  | 'SLOT_UNAVAILABLE'
  | 'SLOT_OUTSIDE_BRANCH_HOURS'
  | 'BOOKING_HORIZON_EXCEEDED'
  | 'MIN_NOTICE_NOT_MET'
  | 'EMPLOYEE_INTERVAL_BUSY_GLOBAL'
  | 'PLAN_CREATE_MISMATCH'
  | 'SERVICES_NOT_CONFIGURED'
  | 'SERVICE_CATALOG_UNAVAILABLE'
  | 'BARBER_NOT_FOUND'
  | 'INVALID_DATE'
  | 'INVALID_DATE_RANGE'
  | 'DATE_RANGE_TOO_LARGE'
  | 'BARBER_CATALOG_UNAVAILABLE'
  | 'NO_ELIGIBLE_BARBER'
  | 'AVAILABILITY_UNAVAILABLE'
  | 'INVALID_TIME'
  | 'CHECK_SLOT_UNAVAILABLE'
  | 'BOOKING_PLAN_UNAVAILABLE'
  | 'BOOKING_PLAN_GENERATION_FAILED'
  | 'PLAN_CHECK_SLOT_MISMATCH'
  | 'PLAN_TOKEN_INVALID'
  | 'PLAN_TOKEN_EXPIRED'
  | 'PLAN_TOKEN_REQUEST_MISMATCH'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST'
  | 'IDEMPOTENCY_REQUEST_IN_PROGRESS'
  | 'BOOKING_LOCK_TIMEOUT'
  | 'BOOKING_CODE_GENERATION_FAILED'
  | 'BOOKING_CREATE_FAILED'
  | 'INVALID_CUSTOMER'
  | 'INVALID_NOTES'
  | 'INVALID_BOOKING_CODE'
  | 'BOOKING_NOT_FOUND'
  | 'BOOKING_NOT_FOUND_OR_UNAUTHORIZED'
  | 'INVALID_CUSTOMER_PHONE'
  | 'BOOKING_ACCESS_TOKEN_INVALID'
  | 'BOOKING_ACCESS_TOKEN_EXPIRED'
  | 'BOOKING_LOOKUP_UNAVAILABLE'
  | 'UPCOMING_BOOKINGS_UNAVAILABLE'
  | 'INVALID_LIMIT'
  | 'INVALID_FROM_DATE'
  | 'BOOKING_ALREADY_CANCELLED'
  | 'BOOKING_NOT_CANCELLABLE'
  | 'BOOKING_CANCELLATION_WINDOW_CLOSED'
  | 'BOOKING_CANCELLATION_REQUIRES_STAFF'
  | 'BOOKING_ALREADY_IN_SERVICE'
  | 'BOOKING_ALREADY_COMPLETED'
  | 'BOOKING_HAS_PAYMENT'
  | 'BOOKING_CANCELLATION_FAILED'
  | 'CORS_ORIGIN_NOT_ALLOWED'
  | 'PLAN_TOKEN_REQUIRED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'LEGACY_BOOKING_CONTRACT_DISABLED'
  | 'INVALID_REQUEST';

export type PublicBookingErrorDef = {
  code: PublicBookingErrorCode;
  httpStatus: number;
  messageAr: string;
  messageEn: string;
};

export const PUBLIC_BOOKING_ERROR_CATALOG: Record<PublicBookingErrorCode, PublicBookingErrorDef> = {
  BRANCH_REQUIRED: {
    code: 'BRANCH_REQUIRED',
    httpStatus: 400,
    messageAr: 'اختر الفرع أولًا',
    messageEn: 'branchCode is required',
  },
  BRANCH_NOT_FOUND: {
    code: 'BRANCH_NOT_FOUND',
    httpStatus: 404,
    messageAr: 'الفرع غير موجود',
    messageEn: 'Unknown branchCode',
  },
  BRANCH_NOT_PUBLIC: {
    code: 'BRANCH_NOT_PUBLIC',
    httpStatus: 404,
    messageAr: 'الفرع غير متاح',
    messageEn: 'Branch is not publicly bookable',
  },
  BRANCH_BOOKING_DISABLED: {
    code: 'BRANCH_BOOKING_DISABLED',
    httpStatus: 409,
    messageAr: 'الحجز متوقف مؤقتاً لهذا الفرع',
    messageEn: 'Public booking is temporarily disabled for this branch',
  },
  INVALID_BRANCH_CODE: {
    code: 'INVALID_BRANCH_CODE',
    httpStatus: 400,
    messageAr: 'رمز الفرع غير صالح',
    messageEn: 'Malformed branchCode',
  },
  BRANCH_CLOSED_ON_WORKDATE: {
    code: 'BRANCH_CLOSED_ON_WORKDATE',
    httpStatus: 409,
    messageAr: 'الفرع مغلق في هذا اليوم',
    messageEn: 'Branch closed on this work date',
  },
  BARBER_NOT_ASSIGNED: {
    code: 'BARBER_NOT_ASSIGNED',
    httpStatus: 409,
    messageAr: 'الحلاق غير معيّن على هذا الفرع',
    messageEn: 'Barber not assigned to this branch',
  },
  BARBER_DAY_OFF: {
    code: 'BARBER_DAY_OFF',
    httpStatus: 409,
    messageAr: 'الحلاق في إجازة هذا اليوم',
    messageEn: 'Barber is off this day',
  },
  BARBER_AVAILABLE_AT_DIFFERENT_BRANCH: {
    code: 'BARBER_AVAILABLE_AT_DIFFERENT_BRANCH',
    httpStatus: 409,
    messageAr: 'الحلاق متاح في فرع آخر',
    messageEn: 'Barber available at a different branch',
  },
  BARBER_FULLY_BOOKED: {
    code: 'BARBER_FULLY_BOOKED',
    httpStatus: 409,
    messageAr: 'لا توجد مواعيد متاحة لهذا الحلاق',
    messageEn: 'Barber fully booked',
  },
  SERVICE_NOT_AVAILABLE_AT_BRANCH: {
    code: 'SERVICE_NOT_AVAILABLE_AT_BRANCH',
    httpStatus: 409,
    messageAr: 'الخدمة غير متاحة في هذا الفرع',
    messageEn: 'Service not available at branch',
  },
  BARBER_CANNOT_PERFORM_SERVICE: {
    code: 'BARBER_CANNOT_PERFORM_SERVICE',
    httpStatus: 409,
    messageAr: 'الحلاق لا يؤدي هذه الخدمة',
    messageEn: 'Barber cannot perform this service',
  },
  INVALID_DAY_OFFSET: {
    code: 'INVALID_DAY_OFFSET',
    httpStatus: 400,
    messageAr: 'قيمة dayOffset غير صالحة',
    messageEn: 'Invalid dayOffset',
  },
  SLOT_UNAVAILABLE: {
    code: 'SLOT_UNAVAILABLE',
    httpStatus: 409,
    messageAr: 'الموعد غير متاح',
    messageEn: 'Slot unavailable',
  },
  SLOT_OUTSIDE_BRANCH_HOURS: {
    code: 'SLOT_OUTSIDE_BRANCH_HOURS',
    httpStatus: 409,
    messageAr: 'الموعد خارج ساعات عمل الفرع',
    messageEn: 'Slot outside branch hours',
  },
  BOOKING_HORIZON_EXCEEDED: {
    code: 'BOOKING_HORIZON_EXCEEDED',
    httpStatus: 409,
    messageAr: 'التاريخ خارج نطاق الحجز المسموح',
    messageEn: 'Booking horizon exceeded',
  },
  MIN_NOTICE_NOT_MET: {
    code: 'MIN_NOTICE_NOT_MET',
    httpStatus: 409,
    messageAr: 'المهلة الدنيا قبل الموعد غير مستوفاة',
    messageEn: 'Minimum notice not met',
  },
  EMPLOYEE_INTERVAL_BUSY_GLOBAL: {
    code: 'EMPLOYEE_INTERVAL_BUSY_GLOBAL',
    httpStatus: 409,
    messageAr: 'الحلاق مشغول في هذا الوقت',
    messageEn: 'Employee interval busy globally',
  },
  PLAN_CREATE_MISMATCH: {
    code: 'PLAN_CREATE_MISMATCH',
    httpStatus: 409,
    messageAr: 'تعارض بين التخطيط وإنشاء الحجز',
    messageEn: 'Plan accepted a slot that create would reject',
  },
  SERVICES_NOT_CONFIGURED: {
    code: 'SERVICES_NOT_CONFIGURED',
    httpStatus: 409,
    messageAr: 'لا توجد خدمات جاهزة للحجز في هذا الفرع',
    messageEn: 'No public-bookable services are configured',
  },
  SERVICE_CATALOG_UNAVAILABLE: {
    code: 'SERVICE_CATALOG_UNAVAILABLE',
    httpStatus: 500,
    messageAr: 'تعذر تحميل قائمة الخدمات',
    messageEn: 'Service catalog temporarily unavailable',
  },
  BARBER_NOT_FOUND: {
    code: 'BARBER_NOT_FOUND',
    httpStatus: 404,
    messageAr: 'الحلاق غير موجود',
    messageEn: 'Barber not found',
  },
  INVALID_DATE: {
    code: 'INVALID_DATE',
    httpStatus: 400,
    messageAr: 'تاريخ غير صالح',
    messageEn: 'Invalid date (expected YYYY-MM-DD)',
  },
  INVALID_DATE_RANGE: {
    code: 'INVALID_DATE_RANGE',
    httpStatus: 400,
    messageAr: 'نطاق التاريخ غير صالح',
    messageEn: 'Invalid date range (from must be <= to)',
  },
  DATE_RANGE_TOO_LARGE: {
    code: 'DATE_RANGE_TOO_LARGE',
    httpStatus: 400,
    messageAr: 'نطاق التاريخ أكبر من المسموح',
    messageEn: 'Date range exceeds the maximum allowed window',
  },
  BARBER_CATALOG_UNAVAILABLE: {
    code: 'BARBER_CATALOG_UNAVAILABLE',
    httpStatus: 500,
    messageAr: 'تعذر تحميل قائمة الحلاقين',
    messageEn: 'Barber catalog temporarily unavailable',
  },
  NO_ELIGIBLE_BARBER: {
    code: 'NO_ELIGIBLE_BARBER',
    httpStatus: 409,
    messageAr: 'لا يوجد حلاق مؤهل لهذه الخدمات',
    messageEn: 'No eligible barber for the selected services',
  },
  AVAILABILITY_UNAVAILABLE: {
    code: 'AVAILABILITY_UNAVAILABLE',
    httpStatus: 500,
    messageAr: 'تعذر تحميل المواعيد المتاحة',
    messageEn: 'Availability temporarily unavailable',
  },
  INVALID_TIME: {
    code: 'INVALID_TIME',
    httpStatus: 400,
    messageAr: 'وقت غير صالح',
    messageEn: 'Invalid time (expected HH:mm)',
  },
  CHECK_SLOT_UNAVAILABLE: {
    code: 'CHECK_SLOT_UNAVAILABLE',
    httpStatus: 409,
    messageAr: 'الموعد لم يعد متاحًا',
    messageEn: 'Requested slot is not available',
  },
  BOOKING_PLAN_UNAVAILABLE: {
    code: 'BOOKING_PLAN_UNAVAILABLE',
    httpStatus: 409,
    messageAr: 'لا يمكن إنشاء خطة لهذا الموعد',
    messageEn: 'Booking plan unavailable for this selection',
  },
  BOOKING_PLAN_GENERATION_FAILED: {
    code: 'BOOKING_PLAN_GENERATION_FAILED',
    httpStatus: 500,
    messageAr: 'تعذر إنشاء خطة الحجز',
    messageEn: 'Booking plan generation failed',
  },
  PLAN_CHECK_SLOT_MISMATCH: {
    code: 'PLAN_CHECK_SLOT_MISMATCH',
    httpStatus: 500,
    messageAr: 'تعارض داخلي بين التحقق والخطة',
    messageEn: 'Internal check-slot / plan parity mismatch',
  },
  PLAN_TOKEN_INVALID: {
    code: 'PLAN_TOKEN_INVALID',
    httpStatus: 400,
    messageAr: 'رمز الخطة غير صالح',
    messageEn: 'Plan token is invalid or tampered',
  },
  PLAN_TOKEN_EXPIRED: {
    code: 'PLAN_TOKEN_EXPIRED',
    httpStatus: 409,
    messageAr: 'انتهت صلاحية رمز الخطة',
    messageEn: 'Plan token expired',
  },
  PLAN_TOKEN_REQUEST_MISMATCH: {
    code: 'PLAN_TOKEN_REQUEST_MISMATCH',
    httpStatus: 409,
    messageAr: 'رمز الخطة لا يطابق طلب الحجز',
    messageEn: 'Plan token does not match create request',
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    code: 'IDEMPOTENCY_KEY_REQUIRED',
    httpStatus: 400,
    messageAr: 'معرّف الطلب مطلوب',
    messageEn: 'clientRequestId or Idempotency-Key is required',
  },
  IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST: {
    code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST',
    httpStatus: 409,
    messageAr: 'تم استخدام معرّف الطلب مع بيانات مختلفة',
    messageEn: 'Idempotency key reused with a different request',
  },
  IDEMPOTENCY_REQUEST_IN_PROGRESS: {
    code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    httpStatus: 409,
    messageAr: 'الطلب قيد المعالجة',
    messageEn: 'Identical create request is already in progress',
  },
  BOOKING_LOCK_TIMEOUT: {
    code: 'BOOKING_LOCK_TIMEOUT',
    httpStatus: 409,
    messageAr: 'تعذر قفل الموعد مؤقتاً — حاول مرة أخرى',
    messageEn: 'Booking lock timeout',
  },
  BOOKING_CODE_GENERATION_FAILED: {
    code: 'BOOKING_CODE_GENERATION_FAILED',
    httpStatus: 500,
    messageAr: 'تعذر إنشاء رمز الحجز',
    messageEn: 'Booking code generation failed',
  },
  BOOKING_CREATE_FAILED: {
    code: 'BOOKING_CREATE_FAILED',
    httpStatus: 500,
    messageAr: 'فشل إنشاء الحجز',
    messageEn: 'Booking create failed',
  },
  INVALID_CUSTOMER: {
    code: 'INVALID_CUSTOMER',
    httpStatus: 400,
    messageAr: 'بيانات العميل غير صالحة',
    messageEn: 'Invalid customer name or phone',
  },
  INVALID_NOTES: {
    code: 'INVALID_NOTES',
    httpStatus: 400,
    messageAr: 'الملاحظات غير صالحة',
    messageEn: 'Notes exceed allowed length',
  },
  INVALID_BOOKING_CODE: {
    code: 'INVALID_BOOKING_CODE',
    httpStatus: 400,
    messageAr: 'كود الحجز غير صالح',
    messageEn: 'Malformed booking code',
  },
  BOOKING_NOT_FOUND: {
    code: 'BOOKING_NOT_FOUND',
    httpStatus: 404,
    messageAr: 'الحجز غير موجود',
    messageEn: 'Booking not found',
  },
  BOOKING_NOT_FOUND_OR_UNAUTHORIZED: {
    code: 'BOOKING_NOT_FOUND_OR_UNAUTHORIZED',
    httpStatus: 404,
    messageAr: 'الحجز غير موجود أو غير مصرح',
    messageEn: 'Booking not found or unauthorized',
  },
  INVALID_CUSTOMER_PHONE: {
    code: 'INVALID_CUSTOMER_PHONE',
    httpStatus: 400,
    messageAr: 'رقم الهاتف غير صالح',
    messageEn: 'Invalid customer phone',
  },
  BOOKING_ACCESS_TOKEN_INVALID: {
    code: 'BOOKING_ACCESS_TOKEN_INVALID',
    httpStatus: 401,
    messageAr: 'رمز الوصول غير صالح',
    messageEn: 'Booking access token invalid',
  },
  BOOKING_ACCESS_TOKEN_EXPIRED: {
    code: 'BOOKING_ACCESS_TOKEN_EXPIRED',
    httpStatus: 401,
    messageAr: 'انتهت صلاحية رمز الوصول',
    messageEn: 'Booking access token expired',
  },
  BOOKING_LOOKUP_UNAVAILABLE: {
    code: 'BOOKING_LOOKUP_UNAVAILABLE',
    httpStatus: 503,
    messageAr: 'تعذر تحميل الحجز حالياً',
    messageEn: 'Booking lookup temporarily unavailable',
  },
  UPCOMING_BOOKINGS_UNAVAILABLE: {
    code: 'UPCOMING_BOOKINGS_UNAVAILABLE',
    httpStatus: 503,
    messageAr: 'تعذر تحميل الحجوزات القادمة',
    messageEn: 'Upcoming bookings temporarily unavailable',
  },
  INVALID_LIMIT: {
    code: 'INVALID_LIMIT',
    httpStatus: 400,
    messageAr: 'حد النتائج غير صالح',
    messageEn: 'Invalid limit',
  },
  INVALID_FROM_DATE: {
    code: 'INVALID_FROM_DATE',
    httpStatus: 400,
    messageAr: 'تاريخ البداية غير صالح',
    messageEn: 'Invalid fromDate',
  },
  BOOKING_ALREADY_CANCELLED: {
    code: 'BOOKING_ALREADY_CANCELLED',
    httpStatus: 200,
    messageAr: 'الحجز ملغي بالفعل',
    messageEn: 'Booking already cancelled',
  },
  BOOKING_NOT_CANCELLABLE: {
    code: 'BOOKING_NOT_CANCELLABLE',
    httpStatus: 409,
    messageAr: 'لا يمكن إلغاء هذا الحجز',
    messageEn: 'Booking is not cancellable',
  },
  BOOKING_CANCELLATION_WINDOW_CLOSED: {
    code: 'BOOKING_CANCELLATION_WINDOW_CLOSED',
    httpStatus: 409,
    messageAr: 'انتهت مهلة الإلغاء المسموحة',
    messageEn: 'Cancellation window has closed',
  },
  BOOKING_CANCELLATION_REQUIRES_STAFF: {
    code: 'BOOKING_CANCELLATION_REQUIRES_STAFF',
    httpStatus: 409,
    messageAr: 'يلزم مساعدة الموظف لإلغاء هذا الحجز',
    messageEn: 'Cancellation requires staff assistance',
  },
  BOOKING_ALREADY_IN_SERVICE: {
    code: 'BOOKING_ALREADY_IN_SERVICE',
    httpStatus: 409,
    messageAr: 'الحجز قيد التنفيذ ولا يمكن إلغاؤه',
    messageEn: 'Booking already in service',
  },
  BOOKING_ALREADY_COMPLETED: {
    code: 'BOOKING_ALREADY_COMPLETED',
    httpStatus: 409,
    messageAr: 'الحجز مكتمل ولا يمكن إلغاؤه',
    messageEn: 'Booking already completed',
  },
  BOOKING_HAS_PAYMENT: {
    code: 'BOOKING_HAS_PAYMENT',
    httpStatus: 409,
    messageAr: 'الحجز مرتبط بمدفوعات — يلزم مساعدة الموظف',
    messageEn: 'Booking has payment — staff assistance required',
  },
  BOOKING_CANCELLATION_FAILED: {
    code: 'BOOKING_CANCELLATION_FAILED',
    httpStatus: 500,
    messageAr: 'تعذر إلغاء الحجز حالياً',
    messageEn: 'Booking cancellation failed',
  },
  CORS_ORIGIN_NOT_ALLOWED: {
    code: 'CORS_ORIGIN_NOT_ALLOWED',
    httpStatus: 403,
    messageAr: 'هذا المصدر غير مسموح له بالوصول إلى خدمة الحجز',
    messageEn: 'Request origin is not in the public booking allowlist',
  },
  PLAN_TOKEN_REQUIRED: {
    code: 'PLAN_TOKEN_REQUIRED',
    httpStatus: 400,
    messageAr: 'رمز الخطة مطلوب',
    messageEn: 'planToken is required',
  },
  RATE_LIMIT_EXCEEDED: {
    code: 'RATE_LIMIT_EXCEEDED',
    httpStatus: 429,
    messageAr: 'تم إرسال عدد كبير من الطلبات، حاول مرة أخرى بعد قليل',
    messageEn: 'Public booking rate limit exceeded',
  },
  LEGACY_BOOKING_CONTRACT_DISABLED: {
    code: 'LEGACY_BOOKING_CONTRACT_DISABLED',
    httpStatus: 400,
    messageAr: 'عقد الحجز القديم لم يعد مدعوماً',
    messageEn: 'Legacy public booking contract is disabled',
  },
  INVALID_REQUEST: {
    code: 'INVALID_REQUEST',
    httpStatus: 400,
    messageAr: 'الطلب غير صالح',
    messageEn: 'Invalid request',
  },
};

/** Nested Phase 1 error shape (preferred for new routes). */
export function publicBookingErrorBody(
  code: PublicBookingErrorCode,
  metadata?: Record<string, unknown>,
) {
  const def = PUBLIC_BOOKING_ERROR_CATALOG[code];
  return {
    ok: false as const,
    error: {
      code: def.code,
      message: def.messageAr,
      technicalMessage: def.messageEn,
      metadata: metadata && Object.keys(metadata).length ? metadata : {},
    },
  };
}

export function publicBookingErrorResponse(
  code: PublicBookingErrorCode,
  metadata?: Record<string, unknown>,
  request?: Request | null,
  cors?: {
    allowedMethods?: PublicBookingCorsMethod[];
    allowedHeaders?: readonly string[];
  },
): NextResponse {
  const def = PUBLIC_BOOKING_ERROR_CATALOG[code];
  const res = NextResponse.json(publicBookingErrorBody(code, metadata), {
    status: def.httpStatus,
  });
  if (!request) {
    // No request context: omit ACAO (never fall back to wildcard for booking errors).
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }
  return withPublicBookingCors(res, request, {
    allowedMethods: cors?.allowedMethods ?? ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: cors?.allowedHeaders,
    cacheControl: 'no-store',
  });
}
