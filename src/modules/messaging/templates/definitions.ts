/**
 * Code is the source of truth for template schema (keys, labels, variables).
 * dbo.TblMessageTemplate stores content only.
 *
 * New feature WhatsApp: add a definition here (+ catalog default + DB seed),
 * then call sendTemplateMessage. Admin /admin/whatsapp lists this automatically.
 */
import {
  ATTENDANCE_CHECK_IN_TEMPLATE_KEY,
  ATTENDANCE_CHECK_OUT_TEMPLATE_KEY,
  BOOKING_CONFIRMATION_TEMPLATE_KEY,
  CUSTOMER_FIRST_TIME_TEMPLATE_KEY,
  EMPLOYEE_ADVANCE_TEMPLATE_KEY,
  EMPLOYEE_DAILY_REPORT_TEMPLATE_KEY,
  EMPLOYEE_FUNDING_TEMPLATE_KEY,
  EMPLOYEE_TIP_TEMPLATE_KEY,
  OWNER_DAILY_REPORT_TEMPLATE_KEY,
  SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY,
  SALE_EMPLOYEE_NOTIFICATION_TEMPLATE_KEY,
} from './catalog';

export type MessageTemplateVariableDefinition = {
  key: string;
  token: string;
  label: string;
  sample: string;
};

export type WhatsAppTemplateDefinition = {
  templateKey: string;
  channel: 'whatsapp';
  language: 'ar';
  label: string;
  description: string;
  availableVariables: MessageTemplateVariableDefinition[];
};

function v(
  key: string,
  label: string,
  sample: string,
): MessageTemplateVariableDefinition {
  return { key, token: `{{${key}}}`, label, sample };
}

const SALE_CUSTOMER_RECEIPT_VARIABLES: MessageTemplateVariableDefinition[] = [
  v('customerName', 'اسم العميل', 'طارق'),
  v('invoiceNumber', 'رقم الفاتورة', 'INV-10025'),
  v('total', 'الإجمالي', '350'),
  v('paymentMethod', 'طريقة الدفع', 'كاش'),
  v('branchName', 'اسم الفرع', 'جليم'),
  v('employeeName', 'اسم الموظف', 'محمد'),
  v('services', 'الخدمات', 'حلاقة شعر'),
];

const CUSTOMER_FIRST_TIME_VARIABLES: MessageTemplateVariableDefinition[] = [
  v('customerName', 'اسم العميل', 'طارق'),
  v('branchName', 'اسم الفرع', 'جليم'),
  v('bookingLink', 'رابط الحجز', 'https://cutsaloon.com/'),
];

const SALE_EMPLOYEE_NOTIFICATION_VARIABLES: MessageTemplateVariableDefinition[] = [
  v('customerName', 'اسم الموظف', 'محمد'),
  v('invoiceNumber', 'رقم الفاتورة', 'INV-10025'),
  v('services', 'الخدمات', 'حلاقة شعر، تحديد دقن'),
  v('branchName', 'اسم الفرع', 'جليم'),
  v('employeeName', 'اسم الموظف (بديل)', 'محمد'),
];

const BOOKING_CONFIRMATION_VARIABLES: MessageTemplateVariableDefinition[] = [
  v('customerName', 'اسم العميل', 'طارق'),
  v('date', 'تاريخ الموعد', '2026-07-16'),
  v('time', 'ساعة الموعد', '14:00'),
  v('service', 'الخدمة', 'حلاقة شعر'),
  v('bookingDate', 'تاريخ الموعد (بديل)', '2026-07-16'),
  v('bookingTime', 'ساعة الموعد (بديل)', '14:00'),
  v('services', 'الخدمات (بديل)', 'حلاقة شعر'),
  v('branchName', 'اسم الفرع', 'جليم'),
  v('barberName', 'اسم الحلاق', 'محمد'),
  v('bookingId', 'رقم الحجز', 'BK-9999'),
  v('bookingLink', 'رابط الحجز', 'https://cutsaloon.com/'),
];

const EMPLOYEE_ADVANCE_VARIABLES: MessageTemplateVariableDefinition[] = [
  v('customerName', 'اسم الموظف', 'محمد'),
  v('amount', 'المبلغ', '500'),
  v('invoiceNumber', 'رقم العملية', 'ADV-9999'),
  v('paymentMethod', 'طريقة الدفع', 'كاش'),
  v('branchName', 'اسم الفرع', 'جليم'),
  v('notes', 'ملاحظات', 'سلفة اختبار'),
];

const EMPLOYEE_FUNDING_VARIABLES: MessageTemplateVariableDefinition[] = [
  v('customerName', 'اسم الموظف', 'محمد'),
  v('amount', 'المبلغ', '300'),
  v('invoiceNumber', 'رقم العملية', 'FUND-9999'),
  v('paymentMethod', 'طريقة الدفع', 'كاش'),
  v('branchName', 'اسم الفرع', 'جليم'),
  v('notes', 'ملاحظات', 'إيراد اختبار'),
];

const ATTENDANCE_CHECK_IN_VARIABLES: MessageTemplateVariableDefinition[] = [
  v('time', 'وقت الحضور', '10:00 ص'),
  v('customerName', 'اسم الموظف', 'محمد'),
];

const ATTENDANCE_CHECK_OUT_VARIABLES: MessageTemplateVariableDefinition[] = [
  v('time', 'وقت الانصراف', '6:00 م'),
  v('customerName', 'اسم الموظف', 'محمد'),
];

const EMPLOYEE_DAILY_REPORT_VARIABLES: MessageTemplateVariableDefinition[] = [
  v('message', 'نص التقرير الكامل', '🌙 تقرير يومك — جليم\nاختبار'),
  v('customerName', 'اسم الموظف', 'محمد'),
  v('workDate', 'تاريخ العمل', '2026-08-25'),
  v('branchName', 'اسم الفرع', 'جليم'),
];

const OWNER_DAILY_REPORT_VARIABLES: MessageTemplateVariableDefinition[] = [
  v('message', 'نص تقرير المالك', '📊 تقرير يوم الفرع\nاختبار'),
  v('customerName', 'اسم المالك', 'طارق'),
  v('branchName', 'اسم الفرع', 'جليم'),
];

const EMPLOYEE_TIP_VARIABLES: MessageTemplateVariableDefinition[] = [
  v('customerName', 'اسم الموظف', 'محمد'),
  v('tipAmount', 'قيمة التبس', '50.00'),
  v('newBalance', 'رصيد الحساب', '350.00'),
  v('paymentMethod', 'طريقة الدفع', 'كاش'),
  v('invoiceTotal', 'إجمالي الفاتورة', '200.00'),
  v('amountPaid', 'المبلغ المدفوع', '50.00'),
];

export const WHATSAPP_TEMPLATE_DEFINITIONS: readonly WhatsAppTemplateDefinition[] = [
  {
    templateKey: SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY,
    channel: 'whatsapp',
    language: 'ar',
    label: 'رسالة فاتورة العميل',
    description: 'تُرسل للعميل بعد تسجيل الفاتورة',
    availableVariables: SALE_CUSTOMER_RECEIPT_VARIABLES,
  },
  {
    templateKey: CUSTOMER_FIRST_TIME_TEMPLATE_KEY,
    channel: 'whatsapp',
    language: 'ar',
    label: 'ترحيب عميل أول مرة',
    description: 'تُرسل للعميل عند أول فاتورة بيع',
    availableVariables: CUSTOMER_FIRST_TIME_VARIABLES,
  },
  {
    templateKey: SALE_EMPLOYEE_NOTIFICATION_TEMPLATE_KEY,
    channel: 'whatsapp',
    language: 'ar',
    label: 'إشعار بيع للموظف',
    description: 'تُرسل لكل موظف مُسند على بنود الفاتورة',
    availableVariables: SALE_EMPLOYEE_NOTIFICATION_VARIABLES,
  },
  {
    templateKey: BOOKING_CONFIRMATION_TEMPLATE_KEY,
    channel: 'whatsapp',
    language: 'ar',
    label: 'تأكيد الحجز',
    description: 'تُرسل للعميل بعد إنشاء/تأكيد الحجز',
    availableVariables: BOOKING_CONFIRMATION_VARIABLES,
  },
  {
    templateKey: EMPLOYEE_ADVANCE_TEMPLATE_KEY,
    channel: 'whatsapp',
    language: 'ar',
    label: 'سلفة موظف',
    description: 'تُرسل للموظف عند تسجيل سلفة',
    availableVariables: EMPLOYEE_ADVANCE_VARIABLES,
  },
  {
    templateKey: EMPLOYEE_FUNDING_TEMPLATE_KEY,
    channel: 'whatsapp',
    language: 'ar',
    label: 'إيراد موظف',
    description: 'تُرسل للموظف عند تسجيل إيراد/تمويل',
    availableVariables: EMPLOYEE_FUNDING_VARIABLES,
  },
  {
    templateKey: ATTENDANCE_CHECK_IN_TEMPLATE_KEY,
    channel: 'whatsapp',
    language: 'ar',
    label: 'إشعار حضور',
    description: 'تُرسل للموظف عند تسجيل الحضور',
    availableVariables: ATTENDANCE_CHECK_IN_VARIABLES,
  },
  {
    templateKey: ATTENDANCE_CHECK_OUT_TEMPLATE_KEY,
    channel: 'whatsapp',
    language: 'ar',
    label: 'إشعار انصراف',
    description: 'تُرسل للموظف عند تسجيل الانصراف',
    availableVariables: ATTENDANCE_CHECK_OUT_VARIABLES,
  },
  {
    templateKey: EMPLOYEE_DAILY_REPORT_TEMPLATE_KEY,
    channel: 'whatsapp',
    language: 'ar',
    label: 'التقرير اليومي للموظف',
    description: 'نص التقرير يُبنى في الـERP ويُمرَّر عبر {{message}}',
    availableVariables: EMPLOYEE_DAILY_REPORT_VARIABLES,
  },
  {
    templateKey: OWNER_DAILY_REPORT_TEMPLATE_KEY,
    channel: 'whatsapp',
    language: 'ar',
    label: 'التقرير اليومي للمالك',
    description: 'نص التقرير يُبنى في الـERP ويُمرَّر عبر {{message}}',
    availableVariables: OWNER_DAILY_REPORT_VARIABLES,
  },
  {
    templateKey: EMPLOYEE_TIP_TEMPLATE_KEY,
    channel: 'whatsapp',
    language: 'ar',
    label: 'إشعار تبس للموظف',
    description: 'تُرسل للموظف عند تسجيل تبس على الفاتورة',
    availableVariables: EMPLOYEE_TIP_VARIABLES,
  },
];

const DEFINITION_BY_KEY = new Map(
  WHATSAPP_TEMPLATE_DEFINITIONS.map((def) => [def.templateKey, def]),
);

export function getWhatsAppTemplateDefinition(
  templateKey: string,
): WhatsAppTemplateDefinition | null {
  const key = String(templateKey ?? '').trim();
  return DEFINITION_BY_KEY.get(key) ?? null;
}

export function listWhatsAppTemplateDefinitions(): WhatsAppTemplateDefinition[] {
  return [...WHATSAPP_TEMPLATE_DEFINITIONS];
}

export function sampleVariablesForDefinition(
  definition: WhatsAppTemplateDefinition,
): Record<string, string> {
  const samples: Record<string, string> = {};
  for (const variable of definition.availableVariables) {
    samples[variable.key] = variable.sample;
  }
  return samples;
}
