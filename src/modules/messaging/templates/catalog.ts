/**
 * Template keys + code defaults.
 * Adding WhatsApp to a new feature: add a key/default here, a definition,
 * an idempotent global seed, then call sendTemplateMessage from the feature.
 * Do not add a WhatsApp-bot route or typed API.
 */
import {
  SALE_CUSTOMER_RECEIPT_DEFAULT_TEMPLATE,
  SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY,
} from './defaults/saleCustomerReceipt';

export { SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY, SALE_CUSTOMER_RECEIPT_DEFAULT_TEMPLATE };

export const CUSTOMER_FIRST_TIME_TEMPLATE_KEY = 'customer.first_time' as const;
export const SALE_EMPLOYEE_NOTIFICATION_TEMPLATE_KEY = 'sale.employee_notification' as const;
export const BOOKING_CONFIRMATION_TEMPLATE_KEY = 'booking.confirmation' as const;
export const EMPLOYEE_ADVANCE_TEMPLATE_KEY = 'employee.advance' as const;
export const EMPLOYEE_FUNDING_TEMPLATE_KEY = 'employee.funding' as const;
export const ATTENDANCE_CHECK_IN_TEMPLATE_KEY = 'attendance.check_in' as const;
export const ATTENDANCE_CHECK_OUT_TEMPLATE_KEY = 'attendance.check_out' as const;
export const EMPLOYEE_DAILY_REPORT_TEMPLATE_KEY = 'employee.daily_report' as const;
export const OWNER_DAILY_REPORT_TEMPLATE_KEY = 'owner.daily_report' as const;
export const EMPLOYEE_TIP_TEMPLATE_KEY = 'employee.tip' as const;

/** Copied from whatsapp-bot DEFAULT_TEMPLATES.first_time — do not restyle. */
export const CUSTOMER_FIRST_TIME_DEFAULT_TEMPLATE = `أهلاً وسهلاً {{customerName}}! 🎉

نورتنا في Cut Salon لأول مرة وفرحانين إنك اخترتنا.

نتمنى تكون التجربة عجبتك، ولو عندك أي ملاحظة احنا دايمًا هنا.

منتظرينك تاني! 💈`;

/**
 * Production POS body from buildEmployeeSaleMessage (message-first on the bot).
 * Not the unused bot DEFAULT_TEMPLATES.employee_sale.
 */
export const SALE_EMPLOYEE_NOTIFICATION_DEFAULT_TEMPLATE = `تم تسجيل فاتورة جديدة لك {{customerName}}:
رقم الفاتورة: {{invoiceNumber}}
الخدمات: {{services}}`;

/** Copied from whatsapp-bot DEFAULT_TEMPLATES.booking — do not restyle. */
export const BOOKING_CONFIRMATION_DEFAULT_TEMPLATE = `أهلاً {{customerName}}،

تم تأكيد حجزك في Cut Salon بنجاح ✅

📅 الموعد: {{date}}
🕐 الساعة: {{time}}
💇 الخدمة: {{service}}

منتظرينك! 💈`;

/** Copied from whatsapp-bot DEFAULT_TEMPLATES.employee_advance — do not restyle. */
export const EMPLOYEE_ADVANCE_DEFAULT_TEMPLATE = `أهلاً {{customerName}} 👋

تم تسجيل سلفة جديدة لك:
المبلغ: {{amount}} ج.م
رقم العملية: {{invoiceNumber}}
طريقة الدفع: {{paymentMethod}}
الفرع: {{branchName}}

ملاحظات: {{notes}}

بالتوفيق! 💈`;

/**
 * Copied from whatsapp-bot buildEmployeeFundingMessage as placeholders.
 * Optional lines omit the same way the bot renderer does.
 */
export const EMPLOYEE_FUNDING_DEFAULT_TEMPLATE = `أهلاً {{customerName}} 👋

تم تسجيل إيراد جديد لك:
المبلغ: {{amount}} ج.م
رقم العملية: {{invoiceNumber}}
طريقة الدفع: {{paymentMethod}}
الفرع: {{branchName}}

ملاحظات: {{notes}}

بالتوفيق! 💈`;

/** Copied from composeAttendanceCheckInWhatsAppMessage — do not restyle. */
export const ATTENDANCE_CHECK_IN_DEFAULT_TEMPLATE = `تم تسجيل حضورك الساعة {{time}}`;

/** Copied from composeAttendanceCheckOutWhatsAppMessage — do not restyle. */
export const ATTENDANCE_CHECK_OUT_DEFAULT_TEMPLATE = `تم تسجيل انصرافك الساعة {{time}}`;

/**
 * Production employee daily body is composed in ERP (composeEmployeeDailyWhatsAppMessage).
 * {{message}} keeps that snapshot editable as a wrapper from Admin.
 */
export const EMPLOYEE_DAILY_REPORT_DEFAULT_TEMPLATE = `{{message}}`;

/** Production owner daily body is composed in ERP (composeOwnerDailyWhatsAppMessage). */
export const OWNER_DAILY_REPORT_DEFAULT_TEMPLATE = `{{message}}`;

/**
 * Production tip body from composeEmployeeTipWhatsAppMessage — do not restyle.
 * {{paymentMethod}} line is omitted when empty (same as legacy optional paymentPart).
 */
export const EMPLOYEE_TIP_DEFAULT_TEMPLATE = `مرحباً {{customerName}}

تم إضافة تبس لحسابك بقيمة {{tipAmount}} ج.م.
رصيدك الحالي في الحساب: {{newBalance}} ج.م.
طريقة الدفع: {{paymentMethod}}`;

export const WHATSAPP_TEMPLATE_KEYS = [
  SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY,
  CUSTOMER_FIRST_TIME_TEMPLATE_KEY,
  SALE_EMPLOYEE_NOTIFICATION_TEMPLATE_KEY,
  BOOKING_CONFIRMATION_TEMPLATE_KEY,
  EMPLOYEE_ADVANCE_TEMPLATE_KEY,
  EMPLOYEE_FUNDING_TEMPLATE_KEY,
  ATTENDANCE_CHECK_IN_TEMPLATE_KEY,
  ATTENDANCE_CHECK_OUT_TEMPLATE_KEY,
  EMPLOYEE_DAILY_REPORT_TEMPLATE_KEY,
  OWNER_DAILY_REPORT_TEMPLATE_KEY,
  EMPLOYEE_TIP_TEMPLATE_KEY,
] as const;

export type WhatsAppTemplateKey = (typeof WHATSAPP_TEMPLATE_KEYS)[number];

export const CODE_DEFAULT_TEMPLATES: Record<string, string> = {
  [SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY]: SALE_CUSTOMER_RECEIPT_DEFAULT_TEMPLATE,
  [CUSTOMER_FIRST_TIME_TEMPLATE_KEY]: CUSTOMER_FIRST_TIME_DEFAULT_TEMPLATE,
  [SALE_EMPLOYEE_NOTIFICATION_TEMPLATE_KEY]: SALE_EMPLOYEE_NOTIFICATION_DEFAULT_TEMPLATE,
  [BOOKING_CONFIRMATION_TEMPLATE_KEY]: BOOKING_CONFIRMATION_DEFAULT_TEMPLATE,
  [EMPLOYEE_ADVANCE_TEMPLATE_KEY]: EMPLOYEE_ADVANCE_DEFAULT_TEMPLATE,
  [EMPLOYEE_FUNDING_TEMPLATE_KEY]: EMPLOYEE_FUNDING_DEFAULT_TEMPLATE,
  [ATTENDANCE_CHECK_IN_TEMPLATE_KEY]: ATTENDANCE_CHECK_IN_DEFAULT_TEMPLATE,
  [ATTENDANCE_CHECK_OUT_TEMPLATE_KEY]: ATTENDANCE_CHECK_OUT_DEFAULT_TEMPLATE,
  [EMPLOYEE_DAILY_REPORT_TEMPLATE_KEY]: EMPLOYEE_DAILY_REPORT_DEFAULT_TEMPLATE,
  [OWNER_DAILY_REPORT_TEMPLATE_KEY]: OWNER_DAILY_REPORT_DEFAULT_TEMPLATE,
  [EMPLOYEE_TIP_TEMPLATE_KEY]: EMPLOYEE_TIP_DEFAULT_TEMPLATE,
};
